package com.preface.api.reconstruction.service;

import com.preface.api.capture.service.CaptureLinkService;
import com.preface.api.reconstruction.dto.CreateReconstructionResponse;
import com.preface.api.reconstruction.dto.CreatedReconstruction;
import com.preface.api.reconstruction.dto.ReconstructionStatusResponse;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CaptureErrorCode;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.entity.ReconstructionWaitQueue;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** 사용자용 복원 API(API-REC-01~03). */
@Service
@Transactional(readOnly = true)
public class ReconstructionService {

    static final List<ReconstructionStatus> IN_PROGRESS =
            List.of(ReconstructionStatus.QUEUED, ReconstructionStatus.RUNNING);

    private final ReconstructionJobRepository jobRepository;
    private final FaceModelRepository faceModelRepository;
    private final FaceUploadGateway faceUploadGateway;
    private final ObjectProvider<ReconstructionStorage> storageProvider;
    private final JsonColumns jsonColumns;
    private final ReconstructionProperties properties;
    private final CaptureLinkService captureLinkService;
    private final Clock clock;

    public ReconstructionService(
            ReconstructionJobRepository jobRepository,
            FaceModelRepository faceModelRepository,
            FaceUploadGateway faceUploadGateway,
            ObjectProvider<ReconstructionStorage> storageProvider,
            JsonColumns jsonColumns,
            ReconstructionProperties properties,
            CaptureLinkService captureLinkService,
            Clock clock) {
        this.jobRepository = jobRepository;
        this.faceModelRepository = faceModelRepository;
        this.faceUploadGateway = faceUploadGateway;
        this.storageProvider = storageProvider;
        this.jsonColumns = jsonColumns;
        this.properties = properties;
        this.captureLinkService = captureLinkService;
        this.clock = clock;
    }

    /**
     * API-REC-01. 업로드 완료 통지 + 작업 생성 + 대기열 등록.
     *
     * <p>사용자 행을 잠가(FOR UPDATE) 같은 사용자의 요청을 한 줄로 세운다. 그래서 "한 번에 하나만"(REC_002)과 같은 uploadId 멱등이 동시
     * 요청에서도 지켜진다. 작업은 먼저 프레임 추출 대기가 되고(DB 행 자체가 대기열, {@link FrameExtractionService}), 추출이 끝나야 GPU
     * 대기열에 들어간다.
     */
    @Transactional
    public CreatedReconstruction create(Requester requester, String uploadId) {
        String userId = requester.userId();
        if (!faceUploadGateway.lockUser(userId)) {
            throw new BusinessException(AuthErrorCode.UNAUTHORIZED);
        }
        FaceUploadGateway.UploadRow upload =
                faceUploadGateway
                        .find(uploadId)
                        .filter(u -> u.userId().equals(userId))
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));

        Optional<ReconstructionJob> existing = jobRepository.findByFaceUploadId(uploadId);
        if (existing.isPresent()) {
            return new CreatedReconstruction(toCreateResponse(existing.get()), false);
        }
        if (!faceUploadGateway.hasFaceDataConsent(userId)) {
            throw new BusinessException(CaptureErrorCode.FACE_DATA_CONSENT_REQUIRED);
        }
        if (upload.expiredOrDeleted()) {
            throw new BusinessException(CaptureErrorCode.UPLOAD_EXPIRED);
        }
        if (jobRepository.existsByUserIdAndStatusIn(userId, IN_PROGRESS)) {
            throw new BusinessException(ReconstructionErrorCode.JOB_IN_PROGRESS);
        }
        switch (storage()
                .checkUpload(upload.objectKey(), upload.sizeBytes(), upload.checksumSha256())) {
            case MISSING -> throw new BusinessException(CaptureErrorCode.UPLOAD_OBJECT_MISSING);
            case CHECKSUM_MISMATCH ->
                    throw new BusinessException(CaptureErrorCode.UPLOAD_CHECKSUM_MISMATCH);
            case PRESENT -> {}
        }

        faceUploadGateway.markUploaded(uploadId, now());
        ReconstructionJob job =
                jobRepository.saveAndFlush(ReconstructionJob.queue(userId, uploadId));
        String jobId = job.getId();
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        // 휴대폰(업로드 전용 세션)으로 만들었으면 PC 폴링(QR-03)이 이 jobId로 대기 화면에 간다
                        if (requester.isCapture()) {
                            captureLinkService.markUploaded(requester.captureLinkId(), jobId);
                        }
                    }
                });
        return new CreatedReconstruction(toCreateResponse(job), true);
    }

    /** API-REC-02. 타인 작업은 존재를 숨기려고 404. */
    public ReconstructionStatusResponse get(Requester requester, String jobId) {
        // 업로드 전용 세션은 그 QR 링크로 만든 작업만 본다(API 명세서 "업로드 전용 세션")
        if (requester.isCapture()
                && !captureLinkService
                        .uploadedJobId(requester.captureLinkId())
                        .map(jobId::equals)
                        .orElse(false)) {
            throw new BusinessException(CommonErrorCode.NOT_FOUND);
        }
        ReconstructionJob job =
                jobRepository
                        .findByIdAndUserId(jobId, requester.userId())
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        return toStatus(job);
    }

    /**
     * API-REC-03. 진행 중 작업, 없으면({@code includeRecentFailed}일 때) 가장 최근 작업이 24시간 안에 실패한 것. 둘 다 없으면
     * null.
     */
    public ReconstructionStatusResponse current(String userId, boolean includeRecentFailed) {
        Optional<ReconstructionJob> running =
                jobRepository.findFirstByUserIdAndStatusInOrderByCreatedAtDescIdDesc(
                        userId, IN_PROGRESS);
        if (running.isPresent()) {
            return toStatus(running.get());
        }
        if (!includeRecentFailed) {
            return null;
        }
        Instant since = now().minus(properties.recentFailureWindow());
        return jobRepository
                .findFirstByUserIdOrderByCreatedAtDescIdDesc(userId)
                .filter(j -> j.getStatus() == ReconstructionStatus.FAILED)
                .filter(j -> j.getFinishedAt() != null && !j.getFinishedAt().isBefore(since))
                .map(this::toStatus)
                .orElse(null);
    }

    private CreateReconstructionResponse toCreateResponse(ReconstructionJob job) {
        Wait wait = wait(job);
        return new CreateReconstructionResponse(
                job.getId(),
                job.getStatus().name(),
                wait.queuePosition(),
                properties.pollInterval().toMillis(),
                wait.waiting(),
                wait.since());
    }

    private ReconstructionStatusResponse toStatus(ReconstructionJob job) {
        String faceModelId =
                job.getStatus() == ReconstructionStatus.SUCCEEDED
                        ? faceModelRepository
                                .findByReconstructionJobId(job.getId())
                                .filter(m -> !m.isDeleted())
                                .map(FaceModel::getId)
                                .orElse(null)
                        : null;
        List<String> failCodes =
                job.getStatus() == ReconstructionStatus.FAILED
                        ? jsonColumns.readStringList(job.getFailCodesJson())
                        : List.of();
        Wait wait = wait(job);
        return new ReconstructionStatusResponse(
                job.getId(),
                job.getStatus().name(),
                job.getStage() == null ? null : job.getStage().name(),
                job.getStage() == null ? null : job.getStage().index(),
                wait.queuePosition(),
                failCodes,
                faceModelId,
                job.getCreatedAt(),
                job.getStartedAt(),
                job.getFinishedAt(),
                wait.waiting(),
                wait.since());
    }

    /** 대기 여부·대기 시작 시각·자기 대기열 안 순번(S15P31B204-729). 기다리지 않으면(추출 중·실행 중·끝남) 모두 비운다. */
    private record Wait(boolean waiting, Instant since, Long queuePosition) {
        static final Wait NONE = new Wait(false, null, null);
    }

    private Wait wait(ReconstructionJob job) {
        Instant staleBefore = now().minus(properties.extractLeaseTimeout());
        ReconstructionWaitQueue queue = job.waitQueue(staleBefore);
        if (queue == null) {
            return Wait.NONE;
        }
        long position =
                switch (queue) {
                    case EXTRACT -> jobRepository.extractQueuePosition(job.getId(), staleBefore);
                    case GPU -> jobRepository.gpuQueuePosition(job.getId());
                };
        Instant since =
                queue.since(
                        job.getCreatedAt(),
                        job.getUpdatedAt(),
                        job.getExtractClaimedAt(),
                        properties.extractLeaseTimeout());
        // 읽는 사이 상태가 바뀌어 자기 행이 빠졌어도 1보다 작게 보이지 않게 한다
        return new Wait(true, since, Math.max(1, position));
    }

    private ReconstructionStorage storage() {
        return storageProvider.getObject();
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.SECONDS);
    }
}
