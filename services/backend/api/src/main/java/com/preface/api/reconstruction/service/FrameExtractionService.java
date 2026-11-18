package com.preface.api.reconstruction.service;

import com.preface.api.notification.service.NotificationService;
import com.preface.api.reconstruction.dto.BundleUrlRequest;
import com.preface.api.reconstruction.dto.ExtractionClaimResponse;
import com.preface.api.reconstruction.dto.ExtractionResultRequest;
import com.preface.api.reconstruction.dto.OutputUrlsResponse;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.deletion.repository.DataDeletionLogRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.reconstruction.ReconstructionOutputKeys;
import com.preface.common.reconstruction.entity.ReconstructionFailCode;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 프레임 추출 워커용 내부 API(INT-EXT-01~03, S15P31B204-353). 계약: {@code contracts/frame-extraction}.
 *
 * <p>추출 워커는 EC2 안에서 돈다. 원본 영상을 받아 프레임 묶음(프레임·마스크·선택 정보·렌즈 메타) 1개를 S3에 올리고 결과를 보고한다. 성공하면 원본 영상을 바로
 * 지우고(S3 삭제 예약 + DB 주소 NULL) 작업을 GPU 대기열에 넣는다.
 *
 * <p>추출 대기열은 DB 행이다: {@code status=QUEUED and frames_ready_at is null}. lease가 끝난 작업은 같은 조건으로 다시
 * 잡히고, 시도 수가 {@code extractMaxAttempts}에 닿은 작업은 다음 claim 때 FAILED(TIMEOUT)가 된다. 추출 워커가 하나도 묻지 않으면
 * claim이 오지 않으므로, job-manager가 같은 두 경우와 오래 기다린 추출 대기를 따로 끝낸다(S15P31B204-593, {@code
 * LeaseRecoveryService.timeOutExtraction}). 실패 정리 규칙은 두 곳이 같아야 한다.
 *
 * <p>묶음 key에 시도 번호를 넣는다. lease로 다른 워커에 넘어간 뒤 이전 워커가 늦게 올려도 새 시도의 묶음을 덮지 않고, 받아들이지 않은 시도의 key는 삭제를
 * 예약한다.
 */
@Slf4j
@Service
public class FrameExtractionService {

    static final String BUNDLE_CONTENT_TYPE = "application/x-tar";

    /** claim 한 번에 정리(시간 초과·입력 없음)하고 넘어갈 수 있는 작업 수. 무한 반복을 막는다. */
    static final int MAX_SKIPS = 20;

    /** 렌즈 정보 출처(contracts/frame-extraction/schemas/lens.schema.json). */
    private static final Set<String> FOCAL_SOURCES =
            Set.of("file", "same-model file", "device profile", "none");

    private static final Set<String> FAIL_CODES =
            Arrays.stream(ReconstructionFailCode.values())
                    .map(Enum::name)
                    .collect(Collectors.toUnmodifiableSet());

    private final ReconstructionJobRepository jobRepository;
    private final FaceUploadGateway faceUploadGateway;
    private final DataDeletionLogRepository deletionLogRepository;
    private final NotificationService notificationService;
    private final ReconstructionQueue queue;
    private final ObjectProvider<ReconstructionStorage> storageProvider;
    private final JsonColumns jsonColumns;
    private final ReconstructionProperties properties;
    private final ReconstructionStageRecorder stageRecorder;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    public FrameExtractionService(
            ReconstructionJobRepository jobRepository,
            FaceUploadGateway faceUploadGateway,
            DataDeletionLogRepository deletionLogRepository,
            NotificationService notificationService,
            ReconstructionQueue queue,
            ObjectProvider<ReconstructionStorage> storageProvider,
            JsonColumns jsonColumns,
            ReconstructionProperties properties,
            ReconstructionStageRecorder stageRecorder,
            PlatformTransactionManager transactionManager,
            Clock clock) {
        this.jobRepository = jobRepository;
        this.faceUploadGateway = faceUploadGateway;
        this.deletionLogRepository = deletionLogRepository;
        this.notificationService = notificationService;
        this.queue = queue;
        this.storageProvider = storageProvider;
        this.jsonColumns = jsonColumns;
        this.properties = properties;
        this.stageRecorder = stageRecorder;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    private record Claimed(String jobId, int attempt, FaceUploadGateway.UploadRow upload) {}

    /** 한 행을 본 결과. {@code claimed}가 null이면 그 행은 정리만 하고 건너뛰었다. */
    private record Step(Claimed claimed) {}

    /** INT-EXT-01. 추출 대기 작업 하나를 가져간다. 없으면 empty(204). */
    public Optional<ExtractionClaimResponse> claim(String workerId) {
        for (int i = 0; i < MAX_SKIPS; i++) {
            Instant now = now();
            Optional<Step> step = transactionTemplate.execute(status -> claimOne(workerId, now));
            if (step == null || step.isEmpty()) {
                return Optional.empty();
            }
            Claimed claimed = step.get().claimed();
            if (claimed != null) {
                log.info(
                        "frame extraction claimed: jobId={}, workerId={}, attempt={}",
                        claimed.jobId(),
                        workerId,
                        claimed.attempt());
                return Optional.of(toResponse(claimed, now));
            }
        }
        return Optional.empty();
    }

    /** 대기 작업이 없으면 empty. */
    private Optional<Step> claimOne(String workerId, Instant now) {
        Optional<String> next =
                jobRepository.lockNextAwaitingFrames(now.minus(properties.extractLeaseTimeout()));
        if (next.isEmpty()) {
            return Optional.empty();
        }
        ReconstructionJob job =
                jobRepository.findByIdForUpdate(next.get()).orElseThrow(IllegalStateException::new);
        if (job.getExtractAttempts() >= properties.extractMaxAttempts()) {
            fail(job, List.of(ReconstructionFailCode.TIMEOUT.name()), null, null, now);
            return Optional.of(new Step(null));
        }
        Optional<FaceUploadGateway.UploadRow> upload =
                faceUploadGateway.find(job.getFaceUploadId());
        if (upload.isEmpty() || upload.get().objectKey() == null) {
            // 원본이 이미 없다(데이터 이상). 다시 시도해도 같으므로 실패로 끝낸다
            fail(
                    job,
                    List.of(ReconstructionFailCode.INTERNAL.name()),
                    "source video missing",
                    null,
                    now);
            return Optional.of(new Step(null));
        }
        job.claimExtraction(workerId, now);
        stageRecorder.extractionStarted(job.getId(), job.getExtractAttempts(), workerId);
        return Optional.of(
                new Step(new Claimed(job.getId(), job.getExtractAttempts(), upload.get())));
    }

    private ExtractionClaimResponse toResponse(Claimed claimed, Instant now) {
        ReconstructionStorage.PresignedUrl video =
                storage().presignGet(claimed.upload().objectKey());
        return new ExtractionClaimResponse(
                claimed.jobId(),
                claimed.attempt(),
                new ExtractionClaimResponse.Video(
                        video.url(),
                        video.expiresAt(),
                        claimed.upload().contentType(),
                        claimed.upload().sizeBytes(),
                        claimed.upload().checksumSha256()),
                properties.maxFrames(),
                now,
                properties.extractLeaseTimeout().toSeconds(),
                ExtractionClaimResponse.Capture.of(
                        claimed.upload().captureMethod(),
                        claimed.upload().deviceModel(),
                        jsonColumns.readMap(claimed.upload().captureTraceJson())));
    }

    /** INT-EXT-02. 묶음 업로드 URL(크기·체크섬 고정). 이 워커·시도의 작업이 아니면 409. */
    @Transactional(readOnly = true)
    public OutputUrlsResponse.Upload bundleUrl(
            String jobId, String workerId, BundleUrlRequest request) {
        ReconstructionJob job =
                jobRepository
                        .findById(jobId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        requireOwner(job, workerId, request.attempt());
        String objectKey = bundleKey(job.getUserId(), job.getFaceUploadId(), request.attempt());
        ReconstructionStorage.PresignedUrl url =
                storage()
                        .presignPut(
                                objectKey,
                                BUNDLE_CONTENT_TYPE,
                                request.sizeBytes(),
                                request.checksumSha256());
        return new OutputUrlsResponse.Upload(
                objectKey, url.url(), "PUT", url.headers(), url.expiresAt());
    }

    /**
     * INT-EXT-03. 이 워커·시도의 작업이 아니면(취소·lease 회수·이미 끝남) 받아들이지 않고 그 시도의 묶음 삭제를 예약한다.
     *
     * @return 받아들였으면 true({@code accepted})
     */
    @Transactional
    public boolean result(String jobId, String workerId, ExtractionResultRequest request) {
        ReconstructionJob job =
                jobRepository
                        .findByIdForUpdate(jobId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        String expectedKey = bundleKey(job.getUserId(), job.getFaceUploadId(), request.attempt());
        if (resent(job, workerId, request.attempt())) {
            // 응답을 못 받은 워커의 재전송. 처음 결과가 이미 반영됐다 — 그 묶음을 지우면 안 된다
            return true;
        }
        if (!job.extractionOwnedBy(workerId, request.attempt())) {
            scheduleBundleDeletion(job, expectedKey);
            log.info(
                    "frame extraction result ignored: jobId={}, workerId={}, attempt={}, status={}",
                    jobId,
                    workerId,
                    request.attempt(),
                    job.getStatus());
            return false;
        }
        Instant now = now();
        String videoMeta = jsonColumns.write("videoMeta", request.videoMeta());
        if (request.succeeded()) {
            succeed(job, request, expectedKey, videoMeta, now);
        } else {
            if (request.failCodes() == null
                    || request.failCodes().isEmpty()
                    || !FAIL_CODES.containsAll(request.failCodes())) {
                throw invalid("failCodes invalid");
            }
            if (retryable(job, request.failCodes())) {
                release(job, request, expectedKey);
            } else {
                fail(job, request.failCodes(), request.debugMessage(), videoMeta, now);
            }
        }
        return true;
    }

    /**
     * INTERNAL 하나만 보고했고 시도가 남았으면 다시 추출한다(S15P31B204-594). 다운로드 끊김·S3 PUT 503·추출 프로세스 OOM 같은 일시적인
     * 오류가 남은 시도를 쓰지 않고 바로 최종 실패가 되던 것을 막는다. 영상 문제(QUALITY_*)와 TIMEOUT은 같은 입력이면 또 실패하므로 그대로 끝낸다. GPU
     * 단계의 같은 규칙: {@code ReconstructionWorkerService.retryable}.
     */
    private boolean retryable(ReconstructionJob job, List<String> failCodes) {
        return failCodes.stream().allMatch(ReconstructionFailCode.INTERNAL.name()::equals)
                && job.getExtractAttempts() < properties.extractMaxAttempts();
    }

    /** lease를 풀어 다음 claim이 바로 가져가게 하고, 이 시도가 올렸을 수 있는 묶음은 지운다. 원본 영상은 남긴다. */
    private void release(
            ReconstructionJob job, ExtractionResultRequest request, String attemptKey) {
        job.releaseExtraction();
        stageRecorder.failOpen(
                job.getId(),
                request.debugMessage() != null
                        ? ReconstructionWorkerService.truncate(request.debugMessage())
                        : ReconstructionFailCode.INTERNAL.name());
        scheduleBundleDeletion(job, attemptKey);
        log.warn(
                "frame extraction requeued after INTERNAL failure: jobId={}, attempt={}, detail={}",
                job.getId(),
                request.attempt(),
                ReconstructionWorkerService.truncate(request.debugMessage()));
    }

    private void succeed(
            ReconstructionJob job,
            ExtractionResultRequest request,
            String expectedKey,
            String videoMeta,
            Instant now) {
        ExtractionResultRequest.Bundle bundle = request.bundle();
        if (bundle == null || !expectedKey.equals(bundle.objectKey())) {
            throw invalid("bundle.objectKey must be the key from bundle-url");
        }
        if (bundle.frameCount() > properties.maxFrames()) {
            throw invalid("bundle.frameCount exceeds maxFrames");
        }
        String lens = jsonColumns.write("lens", requireLens(request.lens()));
        switch (storage()
                .checkUpload(bundle.objectKey(), bundle.sizeBytes(), bundle.checksumSha256())) {
            case MISSING -> throw invalid("bundle not uploaded");
            case CHECKSUM_MISMATCH -> throw invalid("bundle size or checksum mismatch");
            case PRESENT -> {}
        }
        FaceUploadGateway.UploadRow upload =
                faceUploadGateway
                        .find(job.getFaceUploadId())
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        // 원본 영상: S3 삭제를 예약하고(실제 삭제는 삭제 작업) DB 주소를 지운다
        if (upload.objectKey() != null
                && !deletionLogRepository.existsByTargetTypeAndTargetId(
                        DataDeletionLog.TARGET_FACE_UPLOAD, upload.id())) {
            deletionLogRepository.save(
                    DataDeletionLog.pending(
                            job.getUserId(),
                            DataDeletionLog.TARGET_FACE_UPLOAD,
                            upload.id(),
                            upload.objectKey(),
                            DataDeletionLog.REASON_RETENTION_POLICY));
        }
        // 앞선 시도가 묶음을 올리고 결과 보고 전에 끊겼을 수 있다. 쓰지 않는 시도의 묶음은 지금 지운다(S15P31B204-595).
        // 탈퇴·철회 삭제는 저장한 묶음(framesObjectKey) 하나만 지우므로 여기서 지우지 않으면 계속 남는다. 없는 key도 S3 삭제는 성공한다
        for (int attempt = 1; attempt <= job.getExtractAttempts(); attempt++) {
            if (attempt != request.attempt()) {
                scheduleBundleDeletion(
                        job, bundleKey(job.getUserId(), job.getFaceUploadId(), attempt));
            }
        }
        faceUploadGateway.saveFrames(
                upload.id(),
                bundle.objectKey(),
                bundle.sizeBytes(),
                bundle.checksumSha256(),
                bundle.frameCount(),
                lens,
                videoMeta,
                now);
        job.framesReady(now);
        stageRecorder.succeedOpen(job.getId());
        String jobId = job.getId();
        log.info("frames ready: jobId={}, frameCount={}", jobId, bundle.frameCount());
        // 커밋 뒤에 넣는다(GPU 워커가 커밋 전 작업을 가져가 묶음을 못 찾지 않게)
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        queue.enqueue(jobId);
                    }
                });
    }

    /** 추출 단계 실패: 작업 FAILED → 원본 보관 = 지금 + 24h(그때 삭제 작업이 지운다) → 올렸을 수 있는 묶음 삭제 예약 → 알림. */
    private void fail(
            ReconstructionJob job,
            List<String> failCodes,
            String debugMessage,
            String videoMeta,
            Instant now) {
        job.failExtraction(
                now,
                jsonColumns.write("failCodes", failCodes.stream().distinct().toList()),
                ReconstructionWorkerService.truncate(debugMessage));
        // 앞 시도가 lease 만료로 열어 둔 행도 여기서 닫는다(시도를 다 써서 TIMEOUT으로 끝나는 경우)
        stageRecorder.failOpen(
                job.getId(),
                debugMessage != null
                        ? ReconstructionWorkerService.truncate(debugMessage)
                        : String.join(",", failCodes));
        faceUploadGateway.recordResult(
                job.getFaceUploadId(), videoMeta, now.plus(properties.failedUploadRetention()));
        for (int attempt = 1; attempt <= job.getExtractAttempts(); attempt++) {
            scheduleBundleDeletion(job, bundleKey(job.getUserId(), job.getFaceUploadId(), attempt));
        }
        notificationService.reconFailed(job.getUserId(), job.getId());
        log.info("frame extraction failed: jobId={}, failCodes={}", job.getId(), failCodes);
    }

    /** 올렸을 수 있는 묶음의 삭제를 예약한다. 없는 key도 S3 삭제는 성공한다. */
    private void scheduleBundleDeletion(ReconstructionJob job, String objectKey) {
        deletionLogRepository.save(
                DataDeletionLog.pending(
                        job.getUserId(),
                        DataDeletionLog.TARGET_FACE_UPLOAD_FRAMES,
                        job.getFaceUploadId(),
                        objectKey,
                        DataDeletionLog.REASON_RETENTION_POLICY));
    }

    /** GPU가 쓰는 최소 값(focalPx 숫자 또는 null, focalSource)만 검사한다. 나머지 키는 해석하지 않고 그대로 전달한다. */
    private static Map<String, Object> requireLens(Map<String, Object> lens) {
        if (lens == null
                || !lens.containsKey("focalPx")
                || !(lens.get("focalPx") == null || lens.get("focalPx") instanceof Number)
                || !FOCAL_SOURCES.contains(lens.get("focalSource"))) {
            throw invalid("lens.focalPx and lens.focalSource required");
        }
        return lens;
    }

    /** 이 워커·시도가 이미 결과를 냈다(프레임 저장됨 또는 추출 실패). 취소는 재전송으로 보지 않는다. */
    private static boolean resent(ReconstructionJob job, String workerId, int attempt) {
        return workerId.equals(job.getExtractWorkerId())
                && attempt == job.getExtractAttempts()
                && !job.awaitingFrames()
                && job.getStatus() != ReconstructionStatus.CANCELED;
    }

    private static void requireOwner(ReconstructionJob job, String workerId, int attempt) {
        if (job.extractionOwnedBy(workerId, attempt)) {
            return;
        }
        switch (job.getStatus()) {
            case CANCELED -> throw new BusinessException(ReconstructionErrorCode.JOB_CANCELED);
            case SUCCEEDED, FAILED ->
                    throw new BusinessException(ReconstructionErrorCode.RESULT_ALREADY_REPORTED);
            default -> throw new BusinessException(ReconstructionErrorCode.JOB_REASSIGNED);
        }
    }

    /** 묶음 key. 시도마다 다르다. */
    static String bundleKey(String userId, String uploadId, int attempt) {
        return ReconstructionOutputKeys.framesBundle(userId, uploadId, attempt);
    }

    private static BusinessException invalid(String detail) {
        return new BusinessException(CommonErrorCode.INVALID_REQUEST, detail);
    }

    private ReconstructionStorage storage() {
        return storageProvider.getObject();
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.SECONDS);
    }
}
