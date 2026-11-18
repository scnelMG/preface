package com.preface.api.deletion.service;

import com.preface.api.reconstruction.service.ReconstructionProperties;
import com.preface.api.reconstruction.service.ReconstructionStageRecorder;
import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.entity.FaceUploadStatus;
import com.preface.common.capture.repository.FaceUploadRepository;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.deletion.repository.DataDeletionLogRepository;
import com.preface.common.facemodel.entity.FaceCaptureImage;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceCaptureImageRepository;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.notification.repository.NotificationRepository;
import com.preface.common.reconstruction.ReconstructionOutputKeys;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 얼굴 데이터 삭제 절차(탈퇴 FN-AUTH-04, 얼굴 동의 철회 FN-AUTH-03). 호출자의 트랜잭션 안에서만 부른다.
 *
 * <p>S3 객체는 여기서 지우지 않는다. 지울 객체마다 {@code data_deletion_log}에 PENDING 행을 하나씩 남기고, 삭제 작업(스케줄러)이 그 행의
 * {@code object_key}를 지운 뒤 DONE으로 바꾼다. 행 하나 = S3 객체 하나라서, 원래 레코드가 DB에서 사라진 뒤에도 그 행만 보고 무엇을 지울지 안다.
 *
 * <ul>
 *   <li>{@code FACE_UPLOAD}: target_id = face_upload.id, object_key = 원본 영상
 *   <li>{@code RECON_OUTPUT}: target_id = 작업·모델·사진 ID, object_key = 시도별 메시·리그·텍스처·썸네일·사진 한 개
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class FaceDataEraser {

    private static final List<ReconstructionStatus> IN_PROGRESS =
            List.of(ReconstructionStatus.QUEUED, ReconstructionStatus.RUNNING);

    private final ReconstructionJobRepository jobRepository;
    private final FaceUploadRepository faceUploadRepository;
    private final FaceModelRepository faceModelRepository;
    private final FaceCaptureImageRepository faceCaptureImageRepository;
    private final SimulationRepository simulationRepository;
    private final NotificationRepository notificationRepository;
    private final DataDeletionLogRepository deletionLogRepository;
    private final ReconstructionProperties reconstructionProperties;
    private final ReconstructionStageRecorder stageRecorder;

    /**
     * 진행 중(QUEUED·RUNNING) 복원 작업을 CANCELED로. Redis 대기열은 건드리지 않는다 — claim은 QUEUED가 아닌 작업을 건너뛰고,
     * lease 회수는 RUNNING이 아닌 작업을 정리한다.
     */
    public int cancelInProgressJobs(String userId, Instant now, String reason) {
        List<ReconstructionJob> jobs =
                jobRepository.findAllByUserIdAndStatusIn(userId, IN_PROGRESS);
        jobs.forEach(
                job -> {
                    job.cancel(now);
                    stageRecorder.failOpen(job.getId(), "작업 취소: " + reason);
                    for (int attempt = 1;
                            attempt <= reconstructionProperties.maxAttempts();
                            attempt++) {
                        for (String key :
                                ReconstructionOutputKeys.all(userId, job.getId(), attempt)) {
                            deletionLogRepository.save(
                                    DataDeletionLog.pending(
                                            userId,
                                            DataDeletionLog.TARGET_RECON_OUTPUT,
                                            job.getId(),
                                            key,
                                            reason));
                        }
                    }
                });
        return jobs.size();
    }

    /** 아직 삭제되지 않은 원본 영상의 S3 삭제를 예약한다. 이미 삭제 기록이 있는 업로드(복원 성공 직후 등)는 다시 쌓지 않는다. */
    public int scheduleOriginalVideos(String userId, String reason) {
        int count = 0;
        for (FaceUpload upload :
                faceUploadRepository.findAllByUserIdAndStatusNot(
                        userId, FaceUploadStatus.DELETED)) {
            if (deletionLogRepository.existsByTargetTypeAndTargetId(
                    DataDeletionLog.TARGET_FACE_UPLOAD, upload.getId())) {
                continue;
            }
            count +=
                    pending(
                            userId,
                            DataDeletionLog.TARGET_FACE_UPLOAD,
                            upload.getId(),
                            upload.getObjectKey(),
                            reason);
        }
        return count;
    }

    /**
     * 복원 입력 프레임 묶음: 남아 있는 묶음의 S3 삭제를 예약하고 주소를 지운다. 진행 중이던 추출이 늦게 올리는 묶음은 추출 결과 보고가 거절하며 지운다({@code
     * FrameExtractionService}).
     */
    public int scheduleFrameBundles(String userId, String reason) {
        int count = 0;
        for (FaceUpload upload :
                faceUploadRepository.findAllByUserIdAndFramesObjectKeyNotNull(userId)) {
            count +=
                    pending(
                            userId,
                            DataDeletionLog.TARGET_FACE_UPLOAD_FRAMES,
                            upload.getId(),
                            upload.getFramesObjectKey(),
                            reason);
            upload.clearFrames();
        }
        return count;
    }

    /** 설문용 얼굴 사진 5방향: S3 삭제를 예약하고 행을 물리 삭제한다(v2.9 "삭제 방식": 탈퇴·얼굴 동의 철회 때 함께 삭제). */
    public int eraseCaptureImages(String userId, String reason) {
        int count = 0;
        for (FaceCaptureImage image : faceCaptureImageRepository.findAllByUserId(userId)) {
            count +=
                    pending(
                            userId,
                            DataDeletionLog.TARGET_RECON_OUTPUT,
                            image.getId(),
                            image.getObjectKey(),
                            reason);
        }
        faceCaptureImageRepository.deleteAllByUserId(userId);
        return count;
    }

    /**
     * 탈퇴: 얼굴 관련 데이터 전부. 소프트 삭제된 3D·시안도 포함한다(FN-AUTH-04 수용 3).
     *
     * <p>DB 삭제 순서는 FK 방향을 따른다: 알림 → 시안(상담·변경 요청·가중치 이력은 DB CASCADE) → 사진 → 3D → 복원 작업 → 업로드.
     */
    public void eraseAllForWithdrawal(String userId, Instant now) {
        String reason = DataDeletionLog.REASON_WITHDRAWAL;
        int canceled = cancelInProgressJobs(userId, now, reason);
        int objects = scheduleOriginalVideos(userId, reason);
        objects += scheduleFrameBundles(userId, reason);
        for (FaceModel model : faceModelRepository.findAllByUserId(userId)) {
            objects += modelObjects(userId, model, reason);
        }
        objects += eraseCaptureImages(userId, reason);

        notificationRepository.deleteAllByUserId(userId);
        simulationRepository.deleteAllByUserId(userId);
        faceModelRepository.deleteAllByUserId(userId);
        jobRepository.deleteAllByUserId(userId);
        faceUploadRepository.deleteAllByUserId(userId);
        log.info(
                "withdrawal face data erased: userId={}, canceledJobs={}, pendingObjects={}",
                userId,
                canceled,
                objects);
    }

    private int modelObjects(String userId, FaceModel model, String reason) {
        return pending(
                        userId,
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getMeshObjectKey(),
                        reason)
                + pending(
                        userId,
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getSourceMeshObjectKey(),
                        reason)
                + pending(
                        userId,
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getPreviousMeshObjectKey(),
                        reason)
                + pending(
                        userId,
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getRigObjectKey(),
                        reason)
                + pending(
                        userId,
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getSourceRigObjectKey(),
                        reason)
                + pending(
                        userId,
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getExpressionObjectKey(),
                        reason)
                + pending(
                        userId,
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getTextureObjectKey(),
                        reason)
                + pending(
                        userId,
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getThumbnailObjectKey(),
                        reason);
    }

    private int pending(
            String userId, String targetType, String targetId, String objectKey, String reason) {
        if (objectKey == null || objectKey.isBlank()) {
            return 0;
        }
        deletionLogRepository.save(
                DataDeletionLog.pending(userId, targetType, targetId, objectKey, reason));
        return 1;
    }
}
