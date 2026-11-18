package com.preface.api.deletion.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.service.ReconstructionProperties;
import com.preface.api.reconstruction.service.ReconstructionStageRecorder;
import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.entity.FaceUploadStatus;
import com.preface.common.capture.repository.FaceUploadRepository;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.deletion.repository.DataDeletionLogRepository;
import com.preface.common.facemodel.entity.CaptureAngle;
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
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

class FaceDataEraserTest {

    private static final Instant NOW = Instant.parse("2026-10-23T00:00:00Z");
    private static final String USER = "00000000-0000-0000-0000-000000000001";
    private static final String PREFIX = "users/" + USER + "/models/job-1/a1/";

    private final ReconstructionJobRepository jobs = mock(ReconstructionJobRepository.class);
    private final FaceUploadRepository uploads = mock(FaceUploadRepository.class);
    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final FaceCaptureImageRepository images = mock(FaceCaptureImageRepository.class);
    private final SimulationRepository simulations = mock(SimulationRepository.class);
    private final NotificationRepository notifications = mock(NotificationRepository.class);
    private final DataDeletionLogRepository logs = mock(DataDeletionLogRepository.class);
    private final FaceDataEraser eraser =
            new FaceDataEraser(
                    jobs,
                    uploads,
                    models,
                    images,
                    simulations,
                    notifications,
                    logs,
                    new ReconstructionProperties(null, null, null, null, 2, null, null, 0, null, 0),
                    mock(ReconstructionStageRecorder.class));

    private ReconstructionJob running;

    @BeforeEach
    void setUp() {
        running = ReconstructionJob.queue(USER, "up-1");
        ReflectionTestUtils.setField(running, "id", "running-job");
        running.start(NOW.minusSeconds(60));
        when(jobs.findAllByUserIdAndStatusIn(eq(USER), any())).thenReturn(List.of(running));
        when(uploads.findAllByUserIdAndStatusNot(USER, FaceUploadStatus.DELETED))
                .thenReturn(List.of(upload("up-1"), upload("up-2")));
        when(logs.existsByTargetTypeAndTargetId(DataDeletionLog.TARGET_FACE_UPLOAD, "up-2"))
                .thenReturn(true);
        // 텍스처는 GLB에 내장돼 key가 없다
        when(models.findAllByUserId(USER))
                .thenReturn(
                        List.of(
                                FaceModel.create(
                                        USER,
                                        "job-1",
                                        PREFIX + "mesh.glb",
                                        PREFIX + "rig.json",
                                        PREFIX + "expression.json",
                                        null,
                                        PREFIX + "thumbnail.webp",
                                        "GLB",
                                        "v1",
                                        null)));
        when(images.findAllByUserId(USER))
                .thenReturn(
                        List.of(CaptureAngle.values()).stream()
                                .map(
                                        a ->
                                                FaceCaptureImage.of(
                                                        "model-1", USER, a, PREFIX + a.fileName()))
                                .toList());
    }

    @Test
    void 탈퇴하면_S3_객체마다_PENDING_행을_남기고_진행_중_작업을_취소한_뒤_DB_행을_지운다() {
        eraser.eraseAllForWithdrawal(USER, NOW);

        assertThat(running.getStatus()).isEqualTo(ReconstructionStatus.CANCELED);
        List<DataDeletionLog> saved = savedLogs();
        List<String> expected = new ArrayList<>();
        for (int attempt = 1; attempt <= 2; attempt++) {
            expected.addAll(ReconstructionOutputKeys.all(USER, "running-job", attempt));
        }
        expected.add(uploadKey("up-1"));
        expected.addAll(
                List.of(
                        PREFIX + "mesh.glb",
                        PREFIX + "rig.json",
                        PREFIX + "expression.json",
                        PREFIX + "thumbnail.webp"));
        for (CaptureAngle angle : CaptureAngle.values()) {
            expected.add(PREFIX + angle.fileName());
        }
        assertThat(saved)
                .extracting(DataDeletionLog::getObjectKey)
                .containsExactlyInAnyOrderElementsOf(expected);
        assertThat(saved)
                .allSatisfy(
                        log -> {
                            assertThat(log.getUserId()).isEqualTo(USER);
                            assertThat(log.getReason()).isEqualTo("WITHDRAWAL");
                            assertThat(log.getStatus()).isEqualTo("PENDING");
                        });
        assertThat(saved)
                .filteredOn(log -> DataDeletionLog.TARGET_RECON_OUTPUT.equals(log.getTargetType()))
                .hasSize(29);

        InOrder order = inOrder(notifications, simulations, images, models, jobs, uploads);
        order.verify(images).deleteAllByUserId(USER);
        order.verify(notifications).deleteAllByUserId(USER);
        order.verify(simulations).deleteAllByUserId(USER);
        order.verify(models).deleteAllByUserId(USER);
        order.verify(jobs).deleteAllByUserId(USER);
        order.verify(uploads).deleteAllByUserId(USER);
    }

    @Test
    void 얼굴_동의를_철회하면_사진과_남은_원본만_지우고_3D와_시안은_남긴다() {
        eraser.cancelInProgressJobs(USER, NOW, DataDeletionLog.REASON_CONSENT_WITHDRAWN);
        int photos = eraser.eraseCaptureImages(USER, DataDeletionLog.REASON_CONSENT_WITHDRAWN);
        int videos = eraser.scheduleOriginalVideos(USER, DataDeletionLog.REASON_CONSENT_WITHDRAWN);

        assertThat(photos).isEqualTo(5);
        assertThat(videos).isEqualTo(1);
        assertThat(savedLogs())
                .extracting(DataDeletionLog::getReason)
                .containsOnly("CONSENT_WITHDRAWN");
        verify(images).deleteAllByUserId(USER);
        verify(models, org.mockito.Mockito.never()).deleteAllByUserId(anyString());
        verify(simulations, org.mockito.Mockito.never()).deleteAllByUserId(anyString());
    }

    @Test
    void 소급_전환한_모델을_탈퇴_삭제할_때_새_메시와_원본_메시를_모두_예약한다() {
        FaceModel model =
                FaceModel.create(
                        USER,
                        "job-1",
                        PREFIX + "mesh.glb",
                        null,
                        null,
                        null,
                        null,
                        "GLB",
                        "v1",
                        null);
        model.activateWeightShapeMesh(
                PREFIX + "mesh.glb", PREFIX + "mesh-weight-shape-v1-synthetic.glb", null, "{}");
        when(models.findAllByUserId(USER)).thenReturn(List.of(model));
        eraser.eraseAllForWithdrawal(USER, NOW);
        assertThat(savedLogs())
                .extracting(DataDeletionLog::getObjectKey)
                .contains(PREFIX + "mesh.glb", PREFIX + "mesh-weight-shape-v1-synthetic.glb");
    }

    private List<DataDeletionLog> savedLogs() {
        ArgumentCaptor<DataDeletionLog> captor = ArgumentCaptor.forClass(DataDeletionLog.class);
        verify(logs, atLeastOnce()).save(captor.capture());
        return captor.getAllValues();
    }

    private static FaceUpload upload(String id) {
        return FaceUpload.issue(
                id,
                USER,
                uploadKey(id),
                "video/mp4",
                1000,
                30000,
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                NOW);
    }

    private static String uploadKey(String id) {
        return "users/" + USER + "/uploads/" + id + ".mp4";
    }
}
