package com.preface.api.reconstruction.service;

import com.preface.api.notification.service.NotificationService;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.deletion.repository.DataDeletionLogRepository;
import com.preface.common.facemodel.entity.CaptureAngle;
import com.preface.common.facemodel.entity.FaceCaptureImage;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceCaptureImageRepository;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.reconstruction.ReconstructionOutputKeys;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import java.time.Instant;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 작업을 끝낼 때 함께 바뀌어야 하는 것들(결과 보고와 lease 회수가 같이 쓴다). 호출자의 트랜잭션 안에서만 부른다.
 *
 * <ul>
 *   <li>성공: 작업 SUCCEEDED → {@code face_model}·5방향 사진({@code face_capture_image}) 생성 → 입력(프레임 묶음, 남아
 *       있으면 원본 영상) 즉시 삭제 표시({@code retention_expires_at=now} + {@code data_deletion_log} PENDING,
 *       실제 S3 삭제는 삭제 작업이 한다) → 알림
 *   <li>실패: 작업 FAILED → 입력 삭제 예정 = 종료 + 24h(그때 삭제 작업이 기록·삭제) → 알림
 * </ul>
 */
@Component
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
class ReconstructionFinisher {

    private final FaceModelRepository faceModelRepository;
    private final FaceCaptureImageRepository faceCaptureImageRepository;
    private final DataDeletionLogRepository dataDeletionLogRepository;
    private final FaceUploadGateway faceUploadGateway;
    private final NotificationService notificationService;
    private final ReconstructionProperties properties;

    record Success(
            String meshObjectKey,
            String rigObjectKey,
            String expressionObjectKey,
            String textureObjectKey,
            String thumbnailObjectKey,
            String meshFormat,
            String morphSchemaVersion,
            String measurementsJson,
            String qualityReportJson,
            String videoMetaJson,
            Integer durationMs,
            Map<CaptureAngle, String> captureImages,
            String eyeReviewJson,
            String eyePartsSha256,
            String hairMetaJson) {}

    record Failure(
            String failCodesJson,
            String failDetail,
            String qualityReportJson,
            String videoMetaJson,
            Integer durationMs) {}

    FaceModel succeed(ReconstructionJob job, Success result, Instant now) {
        job.succeed(now, result.durationMs(), result.qualityReportJson());
        FaceModel model =
                faceModelRepository.save(
                        FaceModel.create(
                                job.getUserId(),
                                job.getId(),
                                result.meshObjectKey(),
                                result.rigObjectKey(),
                                result.expressionObjectKey(),
                                result.textureObjectKey(),
                                result.thumbnailObjectKey(),
                                result.meshFormat(),
                                result.morphSchemaVersion(),
                                result.measurementsJson()));
        if (result.eyeReviewJson() != null)
            model.recordEyeReview(result.eyeReviewJson(), result.eyePartsSha256());
        if (result.hairMetaJson() != null) model.recordHairMeta(result.hairMetaJson());
        Set<String> linked = new HashSet<>(result.captureImages().values());
        Stream.of(
                        result.meshObjectKey(),
                        result.rigObjectKey(),
                        result.expressionObjectKey(),
                        result.textureObjectKey(),
                        result.thumbnailObjectKey())
                .filter(Objects::nonNull)
                .forEach(linked::add);
        scheduleUnlinkedOutputs(job, linked);
        // 설문용 5방향 사진: 원본 영상과 달리 영구 보관(3D 삭제·탈퇴·동의 철회 때 함께 삭제, S15P31B204-301)
        result.captureImages()
                .forEach(
                        (angle, key) ->
                                faceCaptureImageRepository.save(
                                        FaceCaptureImage.of(
                                                model.getId(), job.getUserId(), angle, key)));
        faceUploadGateway.recordResult(job.getFaceUploadId(), result.videoMetaJson(), now);
        faceUploadGateway
                .find(job.getFaceUploadId())
                .ifPresent(upload -> scheduleInputDeletion(job, upload));
        notificationService.reconSucceeded(job.getUserId(), model.getId());
        return model;
    }

    /**
     * 성공 직후 입력 삭제 예약: 프레임 묶음(주소도 지운다)과, 아직 기록이 없으면 원본 영상(보통은 추출 직후 이미 예약됨). 실제 S3 삭제는 삭제 작업이 한다.
     */
    private void scheduleInputDeletion(ReconstructionJob job, FaceUploadGateway.UploadRow upload) {
        if (upload.framesObjectKey() != null) {
            dataDeletionLogRepository.save(
                    DataDeletionLog.pending(
                            job.getUserId(),
                            DataDeletionLog.TARGET_FACE_UPLOAD_FRAMES,
                            upload.id(),
                            upload.framesObjectKey(),
                            DataDeletionLog.REASON_RETENTION_POLICY));
            faceUploadGateway.clearFrames(upload.id());
        }
        if (upload.objectKey() != null
                && !dataDeletionLogRepository.existsByTargetTypeAndTargetId(
                        DataDeletionLog.TARGET_FACE_UPLOAD, upload.id())) {
            dataDeletionLogRepository.save(
                    DataDeletionLog.pending(
                            job.getUserId(),
                            DataDeletionLog.TARGET_FACE_UPLOAD,
                            upload.id(),
                            upload.objectKey(),
                            DataDeletionLog.REASON_RETENTION_POLICY));
        }
    }

    void fail(ReconstructionJob job, Failure result, Instant now) {
        job.fail(
                now,
                result.failCodesJson(),
                result.failDetail(),
                result.durationMs(),
                result.qualityReportJson());
        scheduleUnlinkedOutputs(job, Set.of());
        faceUploadGateway.recordResult(
                job.getFaceUploadId(),
                result.videoMetaJson(),
                now.plus(properties.failedUploadRetention()));
        notificationService.reconFailed(job.getUserId(), job.getId());
    }

    private void scheduleUnlinkedOutputs(ReconstructionJob job, Set<String> linked) {
        for (int attempt = 1; attempt <= properties.maxAttempts(); attempt++) {
            for (String key : ReconstructionOutputKeys.all(job.getUserId(), job.getId(), attempt)) {
                if (!linked.contains(key)) {
                    dataDeletionLogRepository.save(
                            DataDeletionLog.pending(
                                    job.getUserId(),
                                    DataDeletionLog.TARGET_RECON_OUTPUT,
                                    job.getId(),
                                    key,
                                    DataDeletionLog.REASON_RETENTION_POLICY));
                }
            }
        }
    }
}
