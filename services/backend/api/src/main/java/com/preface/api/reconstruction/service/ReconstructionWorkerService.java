package com.preface.api.reconstruction.service;

import static com.preface.common.reconstruction.ReconstructionOutputKeys.EXPRESSION_FILE;

import com.preface.api.reconstruction.dto.ClaimedJobResponse;
import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.api.reconstruction.dto.OutputUrlsResponse;
import com.preface.api.reconstruction.dto.ProgressRequest;
import com.preface.api.reconstruction.dto.ResultRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.facemodel.entity.CaptureAngle;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.reconstruction.ReconstructionOutputKeys;
import com.preface.common.reconstruction.entity.ReconstructionFailCode;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionStage;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.LinkedHashMap;
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
 * 워커용 내부 API(INT-REC-01~04). 계약: {@code contracts/reconstruction}.
 *
 * <p>상태 확인과 변경은 작업 행 잠금(FOR UPDATE) 안에서 한다. 결과 보고·진행 보고·lease 회수가 같은 작업에 동시에 와도 한 번에 하나씩 처리된다.
 * Redis 정리(처리 중 목록에서 빼기)는 DB 커밋 뒤에 한다(커밋 전에 지우면 장애 때 작업이 사라진다).
 */
@Slf4j
@Service
public class ReconstructionWorkerService {

    /** claim 한 번에 건너뛸 수 있는 오래된 항목(취소된 작업 등) 수. 무한 반복을 막는다. */
    static final int MAX_SKIPS = 20;

    static final String MESH_FILE = "mesh.glb";
    static final String RIG_FILE = "rig.json";
    static final String TEXTURE_FILE = "texture.png";
    static final String THUMBNAIL_FILE = "thumbnail.webp";
    static final String MESH_FORMAT = "GLB";
    static final int MAX_FAIL_DETAIL = 1000;

    private static final String INTERNAL_CODE = ReconstructionFailCode.INTERNAL.name();

    private static final Set<String> FAIL_CODES =
            Arrays.stream(ReconstructionFailCode.values())
                    .map(Enum::name)
                    .collect(Collectors.toUnmodifiableSet());

    private final ReconstructionJobRepository jobRepository;
    private final FaceModelRepository faceModelRepository;
    private final FaceUploadGateway faceUploadGateway;
    private final ReconstructionQueue queue;
    private final ReconstructionFinisher finisher;
    private final NoseModelApproval noseModelApproval;
    private final WeightShapeModelApproval weightShapeModelApproval;
    private final EyeModelApproval eyeModelApproval;
    private final ObjectProvider<ReconstructionStorage> storageProvider;
    private final JsonColumns jsonColumns;
    private final ReconstructionProperties properties;
    private final ReconstructionStageRecorder stageRecorder;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    public ReconstructionWorkerService(
            ReconstructionJobRepository jobRepository,
            FaceModelRepository faceModelRepository,
            FaceUploadGateway faceUploadGateway,
            ReconstructionQueue queue,
            ReconstructionFinisher finisher,
            NoseModelApproval noseModelApproval,
            WeightShapeModelApproval weightShapeModelApproval,
            EyeModelApproval eyeModelApproval,
            ObjectProvider<ReconstructionStorage> storageProvider,
            JsonColumns jsonColumns,
            ReconstructionProperties properties,
            ReconstructionStageRecorder stageRecorder,
            PlatformTransactionManager transactionManager,
            Clock clock) {
        this.jobRepository = jobRepository;
        this.faceModelRepository = faceModelRepository;
        this.faceUploadGateway = faceUploadGateway;
        this.queue = queue;
        this.finisher = finisher;
        this.noseModelApproval = noseModelApproval;
        this.weightShapeModelApproval = weightShapeModelApproval;
        this.eyeModelApproval = eyeModelApproval;
        this.storageProvider = storageProvider;
        this.jsonColumns = jsonColumns;
        this.properties = properties;
        this.stageRecorder = stageRecorder;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    /** claim으로 RUNNING이 된 작업의 입력 정보. */
    private record Started(String jobId, String userId, FaceUploadGateway.UploadRow upload) {}

    /**
     * INT-REC-01. 대기 중 작업 하나를 처리 중 목록으로 옮기고 RUNNING으로 바꾼다. 없으면 empty(204).
     *
     * <p>입력 URL 발급이 실패해도 작업은 처리 중 목록에 남아 lease 만료 뒤 회수된다.
     */
    public Optional<ClaimedJobResponse> claim(String workerId) {
        for (int i = 0; i < MAX_SKIPS; i++) {
            String jobId = queue.moveToProcessing();
            if (jobId == null) {
                return Optional.empty();
            }
            Instant now = now();
            Optional<Started> started = transactionTemplate.execute(status -> start(jobId, now));
            if (started == null || started.isEmpty()) {
                queue.dropOne(jobId);
                continue;
            }
            int attempt = queue.recordClaim(jobId, workerId, now);
            log.info("recon job claimed: jobId={}, workerId={}", jobId, workerId);
            return Optional.of(toClaimed(started.get(), now, attempt));
        }
        return Optional.empty();
    }

    private Optional<Started> start(String jobId, Instant now) {
        Optional<ReconstructionJob> found = jobRepository.findByIdForUpdate(jobId);
        if (found.isEmpty() || found.get().getStatus() != ReconstructionStatus.QUEUED) {
            return Optional.empty();
        }
        ReconstructionJob job = found.get();
        Optional<FaceUploadGateway.UploadRow> upload =
                faceUploadGateway.find(job.getFaceUploadId());
        // 입력은 추출 워커가 만든 프레임 묶음이다. 대기열에는 묶음 저장 뒤에만 들어오므로 없으면 데이터 이상이다
        if (upload.isEmpty() || upload.get().framesObjectKey() == null) {
            return Optional.empty();
        }
        job.start(now);
        return Optional.of(new Started(job.getId(), job.getUserId(), upload.get()));
    }

    private ClaimedJobResponse toClaimed(Started started, Instant now, int attempt) {
        FaceUploadGateway.UploadRow upload = started.upload();
        ReconstructionStorage.PresignedUrl input = storage().presignGet(upload.framesObjectKey());
        return new ClaimedJobResponse(
                started.jobId(),
                new ClaimedJobResponse.Input(
                        input.url(),
                        input.expiresAt(),
                        FrameExtractionService.BUNDLE_CONTENT_TYPE,
                        upload.framesSizeBytes(),
                        upload.framesChecksumSha256(),
                        upload.frameCount(),
                        jsonColumns.readMap(upload.lensMetaJson())),
                ReconstructionOutputKeys.prefix(started.userId(), started.jobId(), attempt),
                properties.morphSchemaVersion(),
                now,
                properties.heartbeatInterval().toSeconds(),
                properties.leaseTimeout().toSeconds());
    }

    /**
     * INT-REC-02. 이 워커의 RUNNING 작업이면 단계를 기록하고 lease를 늘린다. 아니면(취소·회수·종료) {@code continue=false}.
     *
     * <p>단계가 바뀌었으면 단계별 기록(관리자 화면)에서 앞 단계를 닫고 새 단계를 연다. 같은 단계의 반복 보고(heartbeat)는 행을 만들지 않는다.
     */
    @Transactional
    public boolean progress(String jobId, String workerId, ProgressRequest request) {
        ReconstructionJob job = lockJob(jobId);
        if (job.getStatus() != ReconstructionStatus.RUNNING) {
            return false;
        }
        // claim 기록이 없으면(만료·유실) 막지 않는다. 기록이 있으면 같은 워커여야 한다
        Optional<ReconstructionQueue.Claim> claim = queue.claim(jobId);
        if (claim.isPresent() && !claim.get().ownedBy(workerId)) {
            return false;
        }
        ReconstructionStage stage = ReconstructionStage.valueOf(request.stage());
        job.progress(stage, request.engine());
        stageRecorder.gpuProgress(
                jobId, stage, claim.map(ReconstructionQueue.Claim::attempts).orElse(1), workerId);
        Instant now = now();
        afterCommit(() -> queue.touch(jobId, now));
        return true;
    }

    /** INT-REC-04. 결과 객체 업로드 URL(메시·리그·표정 리그·텍스처·썸네일 + 5방향 얼굴 사진). */
    @Transactional(readOnly = true)
    public OutputUrlsResponse outputUrls(String jobId, String workerId) {
        ReconstructionJob job =
                jobRepository
                        .findById(jobId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        ReconstructionQueue.Claim claim = requireActive(job, workerId);
        int attempt = claim == null ? 0 : claim.attempts();
        if (attempt <= 0) {
            throw new BusinessException(ReconstructionErrorCode.JOB_REASSIGNED);
        }
        String prefix = ReconstructionOutputKeys.prefix(job.getUserId(), job.getId(), attempt);
        OutputUrlsResponse response =
                new OutputUrlsResponse(
                        upload(prefix + MESH_FILE, "model/gltf-binary"),
                        upload(prefix + RIG_FILE, "application/json"),
                        upload(prefix + EXPRESSION_FILE, "application/json"),
                        upload(prefix + TEXTURE_FILE, "image/png"),
                        upload(prefix + THUMBNAIL_FILE, "image/webp"),
                        captureUploads(prefix));
        queue.touch(jobId, now());
        return response;
    }

    private Map<String, OutputUrlsResponse.Upload> captureUploads(String prefix) {
        Map<String, OutputUrlsResponse.Upload> captures = new LinkedHashMap<>();
        for (CaptureAngle angle : CaptureAngle.values()) {
            captures.put(angle.name(), upload(prefix + angle.fileName(), "image/jpeg"));
        }
        return captures;
    }

    private OutputUrlsResponse.Upload upload(String objectKey, String contentType) {
        ReconstructionStorage.PresignedUrl url = storage().presignPut(objectKey, contentType);
        return new OutputUrlsResponse.Upload(
                objectKey, url.url(), "PUT", url.headers(), url.expiresAt());
    }

    /**
     * INT-REC-03. 같은 결과의 재전송은 처음 결과를 돌려준다(멱등).
     *
     * <p>성공 보고는 세 단계다(S15P31B204-518). ① 짧게 잠가 상태·소유·출력 key를 확인하고, ② 잠금 없이 코 검증기를 부르고(왕복 최대 11회), ③
     * 다시 잠가 그사이 취소·lease 회수·재배정이 없었는지(RUNNING·같은 워커·같은 시도) 확인한 뒤 작업 성공·모델·사진·코 승인·삭제 예약·알림을 한
     * 트랜잭션으로 저장한다. 검사기 일시 장애의 승인 후보는 같은 모델에서 다시 확인한다. 실패 보고는 한 트랜잭션이다.
     *
     * @return 성공이면 만든 3D 모델 ID, 실패면 null
     */
    public String result(String jobId, String workerId, ResultRequest request) {
        if (!request.succeeded()) {
            return transactionTemplate.execute(status -> reportFailure(jobId, workerId, request));
        }
        Checked checked =
                transactionTemplate.execute(status -> checkSuccess(jobId, workerId, request));
        if (checked.success() == null) {
            return checked.reportedModelId();
        }
        long started = System.nanoTime();
        var nose =
                EditApprovalRetryService.attempt(
                        () ->
                                request.noseApproval() == null
                                        ? null
                                        : noseModelApproval.validateForGeneration(
                                                request.meshObjectKey(),
                                                request.rigObjectKey(),
                                                request.noseApproval()));
        String noseApproval = nose.value();
        String weightShapeApproval =
                weightShapeModelApproval.validateForGeneration(
                        request.meshObjectKey(), noseApproval);
        var eye =
                EditApprovalRetryService.attempt(
                        () ->
                                noseApproval == null
                                        && checked.eyeApproval() != null
                                        && eyeModelApproval.verifyAssets(
                                                request.meshObjectKey(), request.rigObjectKey(),
                                                request.eyeReview(), checked.eyeApproval()));
        log.info(
                "recon edit approvals checked outside lock: jobId={}, noseApproved={}, ms={}",
                jobId,
                noseApproval != null,
                (System.nanoTime() - started) / 1_000_000);
        return transactionTemplate.execute(
                status ->
                        saveSuccess(
                                jobId,
                                workerId,
                                checked,
                                noseApproval,
                                weightShapeApproval,
                                Boolean.TRUE.equals(eye.value()),
                                nose.retry() ? request.noseApproval() : null,
                                eye.retry() ? checked.eyeApproval() : null));
    }

    /**
     * ①의 결과. 이미 성공한 작업의 재전송이면 {@code success}가 null이고 {@code reportedModelId}만 있다.
     *
     * @param attempt 확인한 시도 번호. ③에서 바뀌었으면 저장하지 않는다
     * @param eyeApproval 워커가 보낸 눈 승인 한계(없을 수 있다). ③에서 코 승인 뒤 저장한다
     */
    private record Checked(
            String reportedModelId,
            int attempt,
            ReconstructionFinisher.Success success,
            EyeApprovalRequest eyeApproval) {}

    private Checked checkSuccess(String jobId, String workerId, ResultRequest request) {
        ReconstructionJob job = lockJob(jobId);
        if (job.getStatus() == ReconstructionStatus.SUCCEEDED) {
            return new Checked(reported(job), 0, null, null);
        }
        if (job.getStatus() == ReconstructionStatus.FAILED) {
            throw new BusinessException(ReconstructionErrorCode.RESULT_ALREADY_REPORTED);
        }
        int attempt = activeAttempt(job, workerId);
        String prefix = ReconstructionOutputKeys.prefix(job.getUserId(), job.getId(), attempt);
        requireKey("meshObjectKey", request.meshObjectKey(), prefix + MESH_FILE, true);
        requireKey("rigObjectKey", request.rigObjectKey(), prefix + RIG_FILE, true);
        requireKey(
                "expressionObjectKey",
                request.expressionObjectKey(),
                prefix + EXPRESSION_FILE,
                false);
        if (request.morphSchemaVersion() == null
                || (request.noseApproval() != null
                        && !request.morphSchemaVersion()
                                .equals(request.noseApproval().schemaVersion()))) {
            throw invalid("morphSchemaVersion must match noseApproval when provided");
        }
        requireKey("textureObjectKey", request.textureObjectKey(), prefix + TEXTURE_FILE, false);
        requireKey(
                "thumbnailObjectKey", request.thumbnailObjectKey(), prefix + THUMBNAIL_FILE, false);
        if (!MESH_FORMAT.equals(request.meshFormat())) {
            throw invalid("meshFormat must be GLB");
        }
        Map<CaptureAngle, String> captures = captureImages(request.captureImages(), prefix);
        Map<String, String> eyeReview = request.eyeReview();
        if (eyeReview != null
                && (!eyeReview.keySet().equals(Set.of("L", "R"))
                        || eyeReview.values().stream()
                                .anyMatch(v -> !"present".equals(v) && !"absent".equals(v)))) {
            throw invalid("eyeReview invalid");
        }
        String eyePartsSha256 = request.eyePartsSha256();
        if (eyePartsSha256 != null
                && (eyeReview == null || !eyePartsSha256.matches("[a-f0-9]{64}"))) {
            throw invalid("eyePartsSha256 invalid");
        }
        if (request.measurements() != null
                && request.measurements().containsKey(FaceModel.BASELINE_REVIEW_KEY)) {
            throw invalid("baseline review requires separate approval");
        }
        return new Checked(
                null,
                attempt,
                new ReconstructionFinisher.Success(
                        request.meshObjectKey(),
                        request.rigObjectKey(),
                        request.expressionObjectKey(),
                        request.textureObjectKey(),
                        request.thumbnailObjectKey(),
                        MESH_FORMAT,
                        request.morphSchemaVersion(),
                        jsonColumns.write("measurements", request.measurements()),
                        jsonColumns.write("qualityReport", request.qualityReport()),
                        jsonColumns.write("videoMeta", request.videoMeta()),
                        request.durationMs(),
                        captures,
                        eyeReview == null ? null : jsonColumns.write("eyeReview", eyeReview),
                        eyePartsSha256,
                        hairMetaJson(jobId, request.hairMeta())),
                request.eyeApproval());
    }

    private static final Set<String> HAIR_LENGTHS = Set.of("short", "medium", "long");
    private static final Set<String> HAIR_BANGS = Set.of("none", "partial", "full");
    private static final Set<String> HAIR_PARTS = Set.of("none", "left", "center", "right");
    private static final Set<String> HAIR_COLORS = Set.of("black", "brown", "blond", "gray");

    /** 머리 속성은 추천에만 쓰는 부가 정보라, 형식이 틀리면 작업을 실패시키지 않고 버린다(S15P31B204-551). 값이 없는 항목은 그대로 비워 둔다. */
    private String hairMetaJson(String jobId, ResultRequest.HairMeta hair) {
        if (hair == null) {
            return null;
        }
        boolean ok =
                hair.schemaVersion() != null
                        && hair.schemaVersion().matches("v[0-9]+")
                        && (hair.length() == null || HAIR_LENGTHS.contains(hair.length()))
                        && (hair.bangs() == null || HAIR_BANGS.contains(hair.bangs()))
                        && (hair.part() == null || HAIR_PARTS.contains(hair.part()))
                        && (hair.color() == null || HAIR_COLORS.contains(hair.color()))
                        && (hair.rgb() == null || hair.rgb().matches("#[0-9a-f]{6}"));
        if (!ok) {
            log.warn("hairMeta invalid, dropped: jobId={}", jobId);
            return null;
        }
        return jsonColumns.write("hairMeta", hair);
    }

    /** ③ 검증 뒤 다시 잠가 저장한다. 검증 중 다른 요청이 먼저 성공을 저장했으면 그 결과를 돌려준다(재전송 경합). */
    private String saveSuccess(
            String jobId,
            String workerId,
            Checked checked,
            String noseApproval,
            String weightShapeApproval,
            boolean eyeAssetsVerified,
            NoseApprovalRequest pendingNose,
            EyeApprovalRequest pendingEye) {
        ReconstructionJob job = lockJob(jobId);
        if (job.getStatus() == ReconstructionStatus.SUCCEEDED) {
            return reported(job);
        }
        // 검증하는 동안 취소(REC_020)·실패 확정(REC_021)·lease 회수(REC_022)·다른 시도로 재배정(REC_022)됐으면 저장하지 않는다
        if (activeAttempt(job, workerId) != checked.attempt()) {
            throw new BusinessException(ReconstructionErrorCode.JOB_REASSIGNED);
        }
        FaceModel model = finisher.succeed(job, checked.success(), now());
        stageRecorder.succeedOpen(jobId);
        if (noseApproval != null) model.approveNose(noseApproval);
        if (weightShapeApproval != null) model.approveWeightShape(weightShapeApproval);
        if (checked.eyeApproval() != null
                && !(noseApproval == null
                        ? eyeAssetsVerified
                                && eyeModelApproval.approveWithVerifiedAssets(
                                        model.getId(), checked.eyeApproval())
                        : eyeModelApproval.approveForGeneration(
                                model.getId(), checked.eyeApproval()))) {
            log.warn("eye approval rejected, eye edit stays locked: jobId={}", jobId);
        }
        if (pendingNose != null || pendingEye != null) {
            model.scheduleEditApprovalRetry(
                    jsonColumns.write(
                            "editApprovalRetry",
                            new EditApprovalRetryService.Candidate(
                                    model.getMeshObjectKey(),
                                    model.getRigObjectKey(),
                                    model.getEyePartsSha256(),
                                    model.getEyeReview(),
                                    pendingNose,
                                    pendingEye,
                                    0)),
                    now().plusSeconds(15));
        }
        log.info("recon job finished: jobId={}, status={}", jobId, job.getStatus());
        afterCommit(() -> queue.complete(jobId));
        return model.getId();
    }

    /** 이미 성공한 작업: 대기열만 정리하고 만든 모델 ID를 돌려준다. */
    private String reported(ReconstructionJob job) {
        String jobId = job.getId();
        afterCommit(() -> queue.complete(jobId));
        return faceModelRepository
                .findByReconstructionJobId(jobId)
                .map(FaceModel::getId)
                .orElse(null);
    }

    /** 이 워커가 지금 처리 중인 시도 번호. claim 기록이 없으면 출력 경로를 모르므로 재배정으로 본다. */
    private int activeAttempt(ReconstructionJob job, String workerId) {
        ReconstructionQueue.Claim claim = requireActive(job, workerId);
        if (claim == null
                || claim.workerId() == null
                || !claim.workerId().equals(workerId)
                || claim.attempts() <= 0) {
            throw new BusinessException(ReconstructionErrorCode.JOB_REASSIGNED);
        }
        return claim.attempts();
    }

    private String reportFailure(String jobId, String workerId, ResultRequest request) {
        ReconstructionJob job = lockJob(jobId);
        switch (job.getStatus()) {
            case SUCCEEDED ->
                    throw new BusinessException(ReconstructionErrorCode.RESULT_ALREADY_REPORTED);
            case FAILED -> {
                afterCommit(() -> queue.complete(jobId));
                return null;
            }
            default -> requireActive(job, workerId);
        }
        if (request.failCodes() == null
                || request.failCodes().isEmpty()
                || !FAIL_CODES.containsAll(request.failCodes())) {
            throw invalid("failCodes invalid");
        }
        if (retryable(jobId, request)) {
            // 프로그램 문제(세그폴트 등)는 같은 프레임으로 다시 돌리면 통과할 수 있다. 결과를 확정하지 않고 대기열로 돌린다.
            // 시도 횟수는 lease 회수와 같은 claim 기록을 쓴다(둘을 합쳐 maxAttempts까지)
            job.requeue();
            stageRecorder.failOpen(jobId, stageDetail(request));
            log.warn(
                    "recon job requeued after INTERNAL failure: jobId={}, detail={}",
                    jobId,
                    truncate(request.debugMessage()));
            afterCommit(() -> queue.requeue(jobId));
            return null;
        }
        finisher.fail(
                job,
                new ReconstructionFinisher.Failure(
                        jsonColumns.write(
                                "failCodes", request.failCodes().stream().distinct().toList()),
                        truncate(request.debugMessage()),
                        jsonColumns.write("qualityReport", request.qualityReport()),
                        jsonColumns.write("videoMeta", request.videoMeta()),
                        request.durationMs()),
                now());
        stageRecorder.failOpen(jobId, stageDetail(request));
        log.info("recon job finished: jobId={}, status={}", jobId, job.getStatus());
        afterCommit(() -> queue.complete(jobId));
        return null;
    }

    /**
     * INTERNAL 하나만 보고했고 시도가 남았으면 다시 대기열에 넣는다. 사진 문제(FIT_FAILED·QUALITY_*)와 TIMEOUT(같은 입력이면 또 오래
     * 걸린다)은 재시도하지 않는다. claim 기록이 없으면 시도 횟수를 모르므로 재시도하지 않는다(무한 반복 방지).
     */
    private boolean retryable(String jobId, ResultRequest request) {
        if (!request.failCodes().stream().allMatch(INTERNAL_CODE::equals)) {
            return false;
        }
        return queue.claim(jobId).map(c -> c.attempts() < properties.maxAttempts()).orElse(false);
    }

    /** 이 워커가 지금 처리 중인 작업인지. 아니면 상태별 409. */
    private ReconstructionQueue.Claim requireActive(ReconstructionJob job, String workerId) {
        return switch (job.getStatus()) {
            case CANCELED -> throw new BusinessException(ReconstructionErrorCode.JOB_CANCELED);
            case SUCCEEDED, FAILED ->
                    throw new BusinessException(ReconstructionErrorCode.RESULT_ALREADY_REPORTED);
            case QUEUED -> throw new BusinessException(ReconstructionErrorCode.JOB_REASSIGNED);
            case RUNNING -> {
                ReconstructionQueue.Claim claim = queue.claim(job.getId()).orElse(null);
                if (claim != null && !claim.ownedBy(workerId)) {
                    throw new BusinessException(ReconstructionErrorCode.JOB_REASSIGNED);
                }
                yield claim;
            }
        };
    }

    /** 단계 기록의 내부 상세: 워커 디버그 메시지(작업 fail_detail과 같다), 없으면 실패 코드. */
    private static String stageDetail(ResultRequest request) {
        String detail = truncate(request.debugMessage());
        return detail != null ? detail : String.join(",", request.failCodes());
    }

    private ReconstructionJob lockJob(String jobId) {
        return jobRepository
                .findByIdForUpdate(jobId)
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
    }

    private static void requireKey(String field, String key, String expected, boolean required) {
        if (key == null) {
            if (required) {
                throw invalid(field + " required");
            }
            return;
        }
        if (!key.equals(expected)) {
            throw invalid(field + " must be the issued output key");
        }
    }

    /** 성공 보고의 5방향 사진: 방향 5개가 모두 있고(더도 덜도 아님) 각 key가 outputPrefix 안이어야 한다. */
    private static Map<CaptureAngle, String> captureImages(Map<String, String> raw, String prefix) {
        if (raw == null || raw.size() != CaptureAngle.values().length) {
            throw invalid("captureImages must have 5 angles");
        }
        Map<CaptureAngle, String> captures = new EnumMap<>(CaptureAngle.class);
        for (CaptureAngle angle : CaptureAngle.values()) {
            String key = raw.get(angle.name());
            requireKey("captureImages." + angle.name(), key, prefix + angle.fileName(), true);
            captures.put(angle, key);
        }
        return captures;
    }

    static String truncate(String value) {
        if (value == null || value.length() <= MAX_FAIL_DETAIL) {
            return value;
        }
        return value.substring(0, MAX_FAIL_DETAIL);
    }

    private static BusinessException invalid(String detail) {
        return new BusinessException(CommonErrorCode.INVALID_REQUEST, detail);
    }

    private static void afterCommit(Runnable action) {
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        action.run();
                    }
                });
    }

    private ReconstructionStorage storage() {
        return storageProvider.getObject();
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.SECONDS);
    }
}
