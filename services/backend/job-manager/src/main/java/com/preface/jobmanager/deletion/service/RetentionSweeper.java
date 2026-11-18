package com.preface.jobmanager.deletion.service;

import static com.preface.jobmanager.deletion.service.DeletionCodes.REASON_EMPTY_SIMULATION;
import static com.preface.jobmanager.deletion.service.DeletionCodes.REASON_RETENTION_POLICY;
import static com.preface.jobmanager.deletion.service.DeletionCodes.REASON_SOFT_DELETE_EXPIRED;
import static com.preface.jobmanager.deletion.service.DeletionCodes.TARGET_FACE_UPLOAD;
import static com.preface.jobmanager.deletion.service.DeletionCodes.TARGET_FACE_UPLOAD_FRAMES;
import static com.preface.jobmanager.deletion.service.DeletionCodes.TARGET_SIMULATION;

import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.entity.FaceUploadStatus;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.facemodel.entity.FaceCaptureImage;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.user.entity.UserStatus;
import com.preface.jobmanager.deletion.repository.DeletionFaceModelRepository;
import com.preface.jobmanager.deletion.repository.DeletionFaceUploadRepository;
import com.preface.jobmanager.deletion.repository.DeletionLogRepository;
import com.preface.jobmanager.deletion.repository.DeletionNotificationRepository;
import com.preface.jobmanager.deletion.repository.DeletionSimulationRepository;
import com.preface.jobmanager.deletion.repository.DeletionWithdrawnUserRepository;
import java.time.Instant;
import java.util.List;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 보관 기간이 끝난 데이터를 찾아 DB에서 정리하고, 지울 S3 key를 {@code data_deletion_log} PENDING으로 남긴다. 실제 S3 삭제는 {@link
 * PendingDeletionProcessor}가 커밋 뒤에 한다 — DB 행을 먼저 지워도 key가 같은 트랜잭션의 삭제 기록에 남아 S3 실패 시 재시도할 수 있다.
 *
 * <p>각 메서드는 한 배치(최대 {@code batchSize}행)를 한 트랜잭션으로 처리하고 처리한 대상 수를 돌려준다. S3 객체가 없는 삭제(시안)도 기록을
 * 남긴다(object_key NULL → 처리기가 바로 DONE).
 */
@Service
@RequiredArgsConstructor
public class RetentionSweeper {

    private static final List<FaceUploadStatus> LIVE_UPLOAD =
            List.of(FaceUploadStatus.ISSUED, FaceUploadStatus.UPLOADED);
    private static final List<ReconstructionStatus> ACTIVE_JOB =
            List.of(ReconstructionStatus.QUEUED, ReconstructionStatus.RUNNING);

    private final DeletionFaceUploadRepository uploadRepository;
    private final DeletionSimulationRepository simulationRepository;
    private final DeletionFaceModelRepository faceModelRepository;
    private final DeletionLogRepository logRepository;
    private final DeletionNotificationRepository notificationRepository;
    private final DeletionWithdrawnUserRepository withdrawnUserRepository;
    private final DeletionProperties properties;

    /**
     * FN-HIS-04: 원본 영상 보관 시각({@code retention_expires_at})이 지난 업로드. 실패·취소 작업은 종료 + 24h, 작업 없이 남은
     * 발급분은 URL 만료 + 24h로 채워져 있다. 성공 작업은 결과 보고 때 이미 PENDING이 남아 여기서 다시 잡지 않는다.
     */
    @Transactional
    public int scheduleExpiredUploads(Instant now) {
        List<FaceUpload> uploads =
                uploadRepository.findExpired(
                        LIVE_UPLOAD, now, ACTIVE_JOB, TARGET_FACE_UPLOAD, page());
        uploads.forEach(
                u ->
                        logRepository.save(
                                DataDeletionLog.pending(
                                        u.getUserId(),
                                        TARGET_FACE_UPLOAD,
                                        u.getId(),
                                        u.getObjectKey(),
                                        REASON_RETENTION_POLICY)));
        return uploads.size();
    }

    /**
     * 보관 시각이 지난 프레임 묶음(실패·취소 작업의 입력, S15P31B204-353). 삭제를 예약하고 주소를 지운다(다음 실행이 다시 잡지 않게). 성공 작업의 묶음은
     * 결과 보고 때 이미 예약된다.
     */
    @Transactional
    public int scheduleExpiredFrameBundles(Instant now) {
        List<FaceUpload> uploads =
                uploadRepository.findExpiredFrameBundles(now, ACTIVE_JOB, page());
        uploads.forEach(
                u -> {
                    logRepository.save(
                            DataDeletionLog.pending(
                                    u.getUserId(),
                                    TARGET_FACE_UPLOAD_FRAMES,
                                    u.getId(),
                                    u.getFramesObjectKey(),
                                    REASON_RETENTION_POLICY));
                    u.clearFrames();
                });
        return uploads.size();
    }

    /** 생성 뒤 90일이 지난 알림을 물리 삭제한다(동의서·처리방침의 "알림 90일", S15P31B204-354). S3 객체가 없어 삭제 기록은 남기지 않는다. */
    @Transactional
    public int purgeOldNotifications(Instant now) {
        List<String> ids =
                notificationRepository.findIdsCreatedBefore(
                        now.minus(properties.notificationRetention()), page());
        if (ids.isEmpty()) {
            return 0;
        }
        notificationRepository.deleteAllByIdIn(ids);
        return ids.size();
    }

    /**
     * 탈퇴 뒤 1년이 지난 회원의 동의 이력·삭제 기록·식별자 행을 지운다("동의·삭제 기록 탈퇴 후 1년 분리 보관", S15P31B204-354). 끝나지 않은 S3
     * 삭제가 있는 회원은 건너뛴다. 이 삭제 자체는 기록을 남기지 않는다 — 기록 대상(회원)이 사라지기 때문이다.
     */
    @Transactional
    public int purgeWithdrawnUsers(Instant now) {
        List<String> ids =
                withdrawnUserRepository.findPurgeable(
                        UserStatus.WITHDRAWN,
                        now.minus(properties.withdrawnRecordRetention()),
                        DeletionCodes.STATUS_DONE,
                        page());
        if (ids.isEmpty()) {
            return 0;
        }
        // FK 순서: 동의 이력·삭제 기록 → 회원
        withdrawnUserRepository.deleteConsents(ids);
        withdrawnUserRepository.deleteDeletionLogs(ids);
        withdrawnUserRepository.deleteUsers(ids);
        return ids.size();
    }

    /** FN-HIS-05: 생성 뒤 24시간 동안 편집·대화가 없는 빈 시안을 물리 삭제한다. */
    @Transactional
    public int purgeEmptySimulations(Instant now) {
        List<Simulation> simulations =
                simulationRepository.lockEmptyCreatedBefore(
                        now.minus(properties.emptySimulationTtl()), page());
        return purgeSimulations(simulations, REASON_EMPTY_SIMULATION);
    }

    /** FN-HIS-03: 소프트 삭제 뒤 30일이 지난 시안을 물리 삭제한다. */
    @Transactional
    public int purgeSoftDeletedSimulations(Instant now) {
        List<Simulation> simulations =
                simulationRepository.lockSoftDeletedBefore(
                        now.minus(properties.softDeleteRetention()), page());
        return purgeSimulations(simulations, REASON_SOFT_DELETE_EXPIRED);
    }

    /**
     * FN-HIS-03: 소프트 삭제 뒤 30일이 지난 3D를 물리 삭제한다. 메시·텍스처·썸네일과 5방향 사진({@code face_capture_image}) key를
     * 지우기 전에 모아 key마다 PENDING을 남긴다. 연결 시안·사진 행은 FK CASCADE로 함께 지워진다(시안은 SIMULATION 기록도 남긴다).
     */
    @Transactional
    public int purgeSoftDeletedFaceModels(Instant now) {
        List<FaceModel> models =
                faceModelRepository.lockSoftDeletedBefore(
                        now.minus(properties.softDeleteRetention()), page());
        if (models.isEmpty()) {
            return 0;
        }
        List<String> modelIds = models.stream().map(FaceModel::getId).toList();
        List<FaceCaptureImage> captures = faceModelRepository.findCaptureImages(modelIds);
        for (FaceModel model : models) {
            Stream.of(
                            model.getMeshObjectKey(),
                            model.getSourceMeshObjectKey(),
                            model.getExpressionObjectKey(),
                            model.getTextureObjectKey(),
                            model.getThumbnailObjectKey())
                    .filter(key -> key != null && !key.isBlank())
                    .forEach(
                            key ->
                                    logKey(
                                            model.getUserId(),
                                            DataDeletionLog.TARGET_RECON_OUTPUT,
                                            model.getId(),
                                            key));
            if (model.getRigObjectKey() != null && !model.getRigObjectKey().isBlank()) {
                logKey(
                        model.getUserId(),
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getRigObjectKey());
            }
            if (model.getSourceRigObjectKey() != null && !model.getSourceRigObjectKey().isBlank()) {
                logKey(
                        model.getUserId(),
                        DataDeletionLog.TARGET_RECON_OUTPUT,
                        model.getId(),
                        model.getSourceRigObjectKey());
            }
        }
        captures.forEach(
                c ->
                        logKey(
                                c.getUserId(),
                                DataDeletionLog.TARGET_RECON_OUTPUT,
                                c.getId(),
                                c.getObjectKey()));
        simulationRepository
                .findAllByFaceModelIdIn(modelIds)
                .forEach(s -> logSimulation(s, REASON_SOFT_DELETE_EXPIRED));
        faceModelRepository.deleteAllByIdIn(modelIds);
        return models.size();
    }

    private int purgeSimulations(List<Simulation> simulations, String reason) {
        if (simulations.isEmpty()) {
            return 0;
        }
        simulations.forEach(s -> logSimulation(s, reason));
        simulationRepository.deleteAllByIdIn(simulations.stream().map(Simulation::getId).toList());
        return simulations.size();
    }

    /** S3 객체 1개 = 1행(탈퇴·동의 철회 기록과 같은 형식). */
    private void logKey(String userId, String targetType, String targetId, String objectKey) {
        logRepository.save(
                DataDeletionLog.pending(
                        userId, targetType, targetId, objectKey, REASON_SOFT_DELETE_EXPIRED));
    }

    private void logSimulation(Simulation simulation, String reason) {
        logRepository.save(
                DataDeletionLog.pending(
                        simulation.getUserId(),
                        TARGET_SIMULATION,
                        simulation.getId(),
                        null,
                        reason));
    }

    private Pageable page() {
        return PageRequest.of(0, properties.batchSize());
    }
}
