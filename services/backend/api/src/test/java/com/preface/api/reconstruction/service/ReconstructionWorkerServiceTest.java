package com.preface.api.reconstruction.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.api.reconstruction.dto.ProgressRequest;
import com.preface.api.reconstruction.dto.ResultRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.error.ErrorCode;
import com.preface.common.facemodel.entity.CaptureAngle;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

/** 결과·진행 보고의 상태 규칙(계약 README "상태와 회수 규칙" 표). DB·Redis는 mock. */
class ReconstructionWorkerServiceTest {

    private static final String USER = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    private static final String JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40";
    private static final String PREFIX = "users/" + USER + "/models/" + JOB + "/a1/";
    private static final String PREFIX2 = "users/" + USER + "/models/" + JOB + "/a2/";

    private final ReconstructionJobRepository jobRepository =
            mock(ReconstructionJobRepository.class);
    private final ReconstructionQueue queue = mock(ReconstructionQueue.class);
    private final ReconstructionFinisher finisher = mock(ReconstructionFinisher.class);
    private final NoseModelApproval noseEditService = mock(NoseModelApproval.class);
    private final WeightShapeModelApproval weightShapeApproval =
            mock(WeightShapeModelApproval.class);
    private final EyeModelApproval eyeApproval = mock(EyeModelApproval.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private final FaceModelRepository faceModelRepository = mock(FaceModelRepository.class);
    private final ReconstructionStageRecorder stageRecorder =
            mock(ReconstructionStageRecorder.class);
    private final PlatformTransactionManager transactionManager =
            mock(PlatformTransactionManager.class);
    private ReconstructionWorkerService service;

    @BeforeEach
    void setUp() {
        @SuppressWarnings("unchecked")
        ObjectProvider<ReconstructionStorage> storageProvider = mock(ObjectProvider.class);
        when(storageProvider.getObject()).thenReturn(storage);
        when(storage.presignPut(any(), any()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://storage.example.invalid/synthetic",
                                Map.of(),
                                Instant.parse("2026-10-22T06:45:00Z")));
        service =
                new ReconstructionWorkerService(
                        jobRepository,
                        faceModelRepository,
                        mock(FaceUploadGateway.class),
                        queue,
                        finisher,
                        noseEditService,
                        weightShapeApproval,
                        eyeApproval,
                        storageProvider,
                        new JsonColumns(JsonMapper.builder().build()),
                        new ReconstructionProperties(
                                null, null, null, null, 0, null, null, 0, null, 0),
                        stageRecorder,
                        transactionManager,
                        Clock.fixed(Instant.parse("2026-10-22T06:35:00Z"), ZoneOffset.UTC));
        TransactionSynchronizationManager.initSynchronization();
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    @Test
    void 취소된_작업의_결과_보고는_REC_020() {
        ReconstructionJob job = running();
        ReflectionTestUtils.setField(job, "status", ReconstructionStatus.CANCELED);

        assertCode(() -> service.result(JOB, "w1", succeeded(PREFIX + "mesh.glb")), "REC_020");
    }

    @Test
    void 다른_워커에_재배정된_작업의_결과_보고는_REC_022이고_진행_보고는_중단을_알린다() {
        running();
        when(queue.claim(JOB))
                .thenReturn(Optional.of(new ReconstructionQueue.Claim("w2", Instant.now(), 2)));

        assertCode(() -> service.result(JOB, "w1", succeeded(PREFIX + "mesh.glb")), "REC_022");
        assertThat(service.progress(JOB, "w1", new ProgressRequest("RUNNING", "RECONSTRUCT", null)))
                .isFalse();
    }

    @Test
    void 진행_보고는_claim_시도_번호로_단계_기록에_넘기고_다른_워커의_보고는_넘기지_않는다() {
        running();
        when(queue.claim(JOB))
                .thenReturn(Optional.of(new ReconstructionQueue.Claim("w1", Instant.now(), 2)));

        assertThat(service.progress(JOB, "w1", new ProgressRequest("RUNNING", "RECONSTRUCT", null)))
                .isTrue();
        verify(stageRecorder)
                .gpuProgress(
                        JOB,
                        com.preface.common.reconstruction.entity.ReconstructionStage.RECONSTRUCT,
                        2,
                        "w1");

        assertThat(service.progress(JOB, "w9", new ProgressRequest("RUNNING", "FINALIZE", null)))
                .isFalse();
        verify(stageRecorder, times(1))
                .gpuProgress(any(), any(), org.mockito.ArgumentMatchers.anyInt(), any());
    }

    @Test
    void 실패_보고는_열린_단계를_워커_상세로_닫고_INTERNAL_재시도도_닫는다() {
        running();

        service.result(JOB, "w1", failed(List.of("FIT_FAILED")));
        verify(stageRecorder).failOpen(JOB, "x");

        ReconstructionJob retried = running();
        service.result(JOB, "w1", failed(List.of("INTERNAL")));
        assertThat(retried.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        verify(stageRecorder, times(2)).failOpen(JOB, "x");
    }

    @Test
    void 성공_뒤에_실패를_보고하면_REC_021() {
        ReconstructionJob job = running();
        job.succeed(Instant.now(), 1, null);

        assertCode(() -> service.result(JOB, "w1", failed(List.of("INTERNAL"))), "REC_021");
    }

    @Test
    void 출력_key가_outputPrefix_밖이면_COMMON_001이고_아무것도_만들지_않는다() {
        running();

        assertCode(
                () -> service.result(JOB, "w1", succeeded("users/other/models/x/mesh.glb")),
                "COMMON_001");
        assertCode(() -> service.result(JOB, "w1", succeeded(PREFIX)), "COMMON_001");
        assertCode(() -> service.result(JOB, "w1", succeeded(PREFIX + "other.glb")), "COMMON_001");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 리그_key는_발급한_경로만_받는다() {
        running();

        assertCode(
                () ->
                        service.result(
                                JOB,
                                "w1",
                                succeeded(
                                        PREFIX + "mesh.glb",
                                        PREFIX + "other.json",
                                        captures(PREFIX))),
                "COMMON_001");
        assertCode(
                () ->
                        service.result(
                                JOB,
                                "w1",
                                succeeded(
                                        PREFIX + "mesh.glb",
                                        "users/other/rig.json",
                                        captures(PREFIX))),
                "COMMON_001");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 재시도_후_이전_시도_리그_key는_받지_않는다() {
        running();
        when(queue.claim(JOB))
                .thenReturn(Optional.of(new ReconstructionQueue.Claim("w1", Instant.now(), 2)));

        assertCode(
                () ->
                        service.result(
                                JOB,
                                "w1",
                                succeeded(
                                        PREFIX2 + "mesh.glb",
                                        PREFIX + "rig.json",
                                        captures(PREFIX2))),
                "COMMON_001");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 시도_기록이_없으면_리그_업로드_URL을_발급하지_않는다() {
        ReconstructionJob job = running();
        when(jobRepository.findById(JOB)).thenReturn(Optional.of(job));
        when(queue.claim(JOB)).thenReturn(Optional.empty());

        assertCode(() -> service.outputUrls(JOB, "w1"), "REC_022");
    }

    @Test
    void 업로드_URL은_소유_확인에_사용한_시도_번호로만_발급한다() {
        ReconstructionJob job = running();
        when(jobRepository.findById(JOB)).thenReturn(Optional.of(job));
        when(queue.claim(JOB))
                .thenReturn(
                        Optional.of(new ReconstructionQueue.Claim("w1", Instant.now(), 1)),
                        Optional.of(new ReconstructionQueue.Claim("w2", Instant.now(), 2)));

        assertThat(service.outputUrls(JOB, "w1").rig().objectKey()).isEqualTo(PREFIX + "rig.json");
        verify(queue, times(1)).claim(JOB);
    }

    @Test
    void 업로드_URL에_같은_시도_경로의_표정_리그가_있다() {
        ReconstructionJob job = running();
        when(jobRepository.findById(JOB)).thenReturn(Optional.of(job));

        assertThat(service.outputUrls(JOB, "w1").expression().objectKey())
                .isEqualTo(PREFIX + "expression.json");
        verify(storage).presignPut(PREFIX + "expression.json", "application/json");
    }

    @Test
    void 표정_리그_key는_빠져도_되고_있으면_발급한_경로만_받아_모델_등록으로_넘긴다() {
        running();
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn("model-1");
        when(finisher.succeed(any(), any(), any())).thenReturn(model);

        assertCode(
                () -> service.result(JOB, "w1", withExpression(valid(), PREFIX + "rig.json")),
                "COMMON_001");
        assertCode(
                () ->
                        service.result(
                                JOB, "w1", withExpression(valid(), PREFIX2 + "expression.json")),
                "COMMON_001");
        verify(finisher, never()).succeed(any(), any(), any());

        assertThat(service.result(JOB, "w1", withExpression(valid(), PREFIX + "expression.json")))
                .isEqualTo("model-1");
        ArgumentCaptor<ReconstructionFinisher.Success> saved =
                ArgumentCaptor.forClass(ReconstructionFinisher.Success.class);
        verify(finisher).succeed(any(), saved.capture(), any());
        assertThat(saved.getValue().expressionObjectKey()).isEqualTo(PREFIX + "expression.json");

        org.mockito.Mockito.clearInvocations(finisher);
        running();
        assertThat(service.result(JOB, "w1", valid())).isEqualTo("model-1");
        ArgumentCaptor<ReconstructionFinisher.Success> without =
                ArgumentCaptor.forClass(ReconstructionFinisher.Success.class);
        verify(finisher).succeed(any(), without.capture(), any());
        assertThat(without.getValue().expressionObjectKey()).isNull();
    }

    private static ResultRequest withExpression(ResultRequest v, String expressionKey) {
        return new ResultRequest(
                v.status(),
                v.meshObjectKey(),
                v.rigObjectKey(),
                v.textureObjectKey(),
                v.thumbnailObjectKey(),
                v.meshFormat(),
                v.morphSchemaVersion(),
                v.measurements(),
                v.failCodes(),
                v.debugMessage(),
                v.qualityReport(),
                v.videoMeta(),
                v.durationMs(),
                v.captureImages(),
                v.noseApproval(),
                v.eyeReview(),
                v.eyePartsSha256(),
                v.eyeApproval(),
                v.hairMeta(),
                expressionKey);
    }

    @Test
    void 설문용_5방향_사진이_빠지거나_outputPrefix_밖이면_COMMON_001이고_아무것도_만들지_않는다() {
        running();
        Map<String, String> four = new java.util.LinkedHashMap<>(captures(PREFIX));
        four.remove("LEFT_45");
        Map<String, String> outside = new java.util.LinkedHashMap<>(captures(PREFIX));
        outside.put("FRONT", "users/other/models/x/captures/front.jpg");

        assertCode(
                () -> service.result(JOB, "w1", succeeded(PREFIX + "mesh.glb", null)),
                "COMMON_001");
        assertCode(
                () -> service.result(JOB, "w1", succeeded(PREFIX + "mesh.glb", four)),
                "COMMON_001");
        assertCode(
                () -> service.result(JOB, "w1", succeeded(PREFIX + "mesh.glb", outside)),
                "COMMON_001");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 모르는_실패_코드는_COMMON_001() {
        running();

        assertCode(() -> service.result(JOB, "w1", failed(List.of("GPU_ON_FIRE"))), "COMMON_001");
        assertCode(() -> service.result(JOB, "w1", failed(List.of())), "COMMON_001");
    }

    @Test
    void 성공_모델은_같은_트랜잭션에서_코_승인까지_마친다() {
        running();
        FaceModel model =
                FaceModel.create(
                        USER,
                        JOB,
                        PREFIX + "mesh.glb",
                        PREFIX + "rig.json",
                        null,
                        null,
                        null,
                        "GLB",
                        "v1",
                        null);
        ReflectionTestUtils.setField(model, "id", "model-1");
        when(finisher.succeed(any(), any(), any())).thenReturn(model);

        assertThat(
                        service.result(
                                JOB,
                                "w1",
                                succeeded(
                                        PREFIX + "mesh.glb",
                                        PREFIX + "rig.json",
                                        captures(PREFIX))))
                .isEqualTo("model-1");
        verify(noseEditService)
                .validateForGeneration(
                        org.mockito.ArgumentMatchers.eq(PREFIX + "mesh.glb"),
                        org.mockito.ArgumentMatchers.eq(PREFIX + "rig.json"),
                        any());
        org.mockito.Mockito.verifyNoInteractions(eyeApproval);
        verify(stageRecorder).succeedOpen(JOB);
    }

    @Test
    void 눈_승인_후보는_코_승인_뒤에_넘기고_거절돼도_생성은_성공한다() {
        running();
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn("model-1");
        when(finisher.succeed(any(), any(), any())).thenReturn(model);
        when(noseEditService.validateForGeneration(any(), any(), any())).thenReturn("{approval}");
        ResultRequest valid = succeeded(PREFIX + "mesh.glb", PREFIX + "rig.json", captures(PREFIX));
        EyeApprovalRequest eyes =
                new EyeApprovalRequest(
                        "v1",
                        new EyeApprovalRequest.Binding(
                                "a".repeat(64),
                                "b".repeat(64),
                                "c".repeat(64),
                                "engine",
                                "v1",
                                "topology"),
                        Map.of("inner", 100.0, "outer", 70.0, "lower", 100.0, "upper", 40.0));
        ResultRequest approved =
                new ResultRequest(
                        valid.status(),
                        valid.meshObjectKey(),
                        valid.rigObjectKey(),
                        valid.textureObjectKey(),
                        valid.thumbnailObjectKey(),
                        valid.meshFormat(),
                        valid.morphSchemaVersion(),
                        valid.measurements(),
                        valid.failCodes(),
                        valid.debugMessage(),
                        valid.qualityReport(),
                        valid.videoMeta(),
                        valid.durationMs(),
                        valid.captureImages(),
                        valid.noseApproval(),
                        Map.of("L", "present", "R", "present"),
                        "c".repeat(64),
                        eyes);
        when(eyeApproval.approveForGeneration("model-1", eyes)).thenReturn(false);

        assertThat(service.result(JOB, "w1", approved)).isEqualTo("model-1");
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(model, eyeApproval);
        order.verify(model).approveNose(any());
        order.verify(eyeApproval).approveForGeneration("model-1", eyes);
    }

    @Test
    void 눈별_판정을_워커_결과에서_모델_등록으로_전달하고_잘못된_판정은_거절한다() {
        running();
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn("model-1");
        when(finisher.succeed(any(), any(), any())).thenReturn(model);
        ResultRequest valid = succeeded(PREFIX + "mesh.glb", PREFIX + "rig.json", captures(PREFIX));
        ResultRequest reviewed =
                new ResultRequest(
                        valid.status(),
                        valid.meshObjectKey(),
                        valid.rigObjectKey(),
                        valid.textureObjectKey(),
                        valid.thumbnailObjectKey(),
                        valid.meshFormat(),
                        valid.morphSchemaVersion(),
                        valid.measurements(),
                        valid.failCodes(),
                        valid.debugMessage(),
                        valid.qualityReport(),
                        valid.videoMeta(),
                        valid.durationMs(),
                        valid.captureImages(),
                        valid.noseApproval(),
                        Map.of("L", "absent", "R", "present"),
                        "c".repeat(64));

        assertThat(service.result(JOB, "w1", reviewed)).isEqualTo("model-1");
        ArgumentCaptor<ReconstructionFinisher.Success> capture =
                ArgumentCaptor.forClass(ReconstructionFinisher.Success.class);
        verify(finisher).succeed(any(), capture.capture(), any());
        assertThat(capture.getValue().eyeReviewJson())
                .contains("\"L\":\"absent\"")
                .contains("\"R\":\"present\"");
        assertThat(capture.getValue().eyePartsSha256()).isEqualTo("c".repeat(64));

        ResultRequest invalid =
                new ResultRequest(
                        valid.status(),
                        valid.meshObjectKey(),
                        valid.rigObjectKey(),
                        valid.textureObjectKey(),
                        valid.thumbnailObjectKey(),
                        valid.meshFormat(),
                        valid.morphSchemaVersion(),
                        valid.measurements(),
                        valid.failCodes(),
                        valid.debugMessage(),
                        valid.qualityReport(),
                        valid.videoMeta(),
                        valid.durationMs(),
                        valid.captureImages(),
                        valid.noseApproval(),
                        Map.of("L", "unknown", "R", "absent"));
        assertCode(() -> service.result(JOB, "w1", invalid), "COMMON_001");
    }

    private static ResultRequest withHair(ResultRequest v, ResultRequest.HairMeta hair) {
        return new ResultRequest(
                v.status(),
                v.meshObjectKey(),
                v.rigObjectKey(),
                v.textureObjectKey(),
                v.thumbnailObjectKey(),
                v.meshFormat(),
                v.morphSchemaVersion(),
                v.measurements(),
                v.failCodes(),
                v.debugMessage(),
                v.qualityReport(),
                v.videoMeta(),
                v.durationMs(),
                v.captureImages(),
                v.noseApproval(),
                v.eyeReview(),
                v.eyePartsSha256(),
                v.eyeApproval(),
                hair);
    }

    @Test
    void 머리_속성은_모델_등록으로_넘기고_형식이_틀리면_버려도_생성은_성공한다() {
        running();
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn("model-1");
        when(finisher.succeed(any(), any(), any())).thenReturn(model);
        ResultRequest valid = succeeded(PREFIX + "mesh.glb", PREFIX + "rig.json", captures(PREFIX));

        assertThat(
                        service.result(
                                JOB,
                                "w1",
                                withHair(
                                        valid,
                                        new ResultRequest.HairMeta(
                                                "v1", "short", "full", "none", "brown",
                                                "#341f1d"))))
                .isEqualTo("model-1");
        ArgumentCaptor<ReconstructionFinisher.Success> ok =
                ArgumentCaptor.forClass(ReconstructionFinisher.Success.class);
        verify(finisher).succeed(any(), ok.capture(), any());
        assertThat(ok.getValue().hairMetaJson())
                .contains("\"length\":\"short\"")
                .contains("\"rgb\":\"#341f1d\"");

        org.mockito.Mockito.clearInvocations(finisher);
        running();
        assertThat(
                        service.result(
                                JOB,
                                "w1",
                                withHair(
                                        valid,
                                        new ResultRequest.HairMeta(
                                                "v1", "very-long", null, null, null, "red"))))
                .isEqualTo("model-1");
        ArgumentCaptor<ReconstructionFinisher.Success> dropped =
                ArgumentCaptor.forClass(ReconstructionFinisher.Success.class);
        verify(finisher).succeed(any(), dropped.capture(), any());
        assertThat(dropped.getValue().hairMetaJson()).isNull();
    }

    @Test
    void 코_승인_증거가_없어도_모델을_등록하고_코_편집만_잠근다() {
        running();
        ResultRequest valid = succeeded(PREFIX + "mesh.glb", PREFIX + "rig.json", captures(PREFIX));
        Map<String, String> review = Map.of("R", "absent", "L", "present");
        EyeApprovalRequest eyes =
                new EyeApprovalRequest(
                        "v1",
                        new EyeApprovalRequest.Binding(
                                "a".repeat(64),
                                "b".repeat(64),
                                "c".repeat(64),
                                "engine",
                                "v1",
                                "topology"),
                        Map.of("inner", 100.0, "outer", 70.0, "lower", 100.0, "upper", 40.0));
        ResultRequest missing =
                new ResultRequest(
                        valid.status(),
                        valid.meshObjectKey(),
                        valid.rigObjectKey(),
                        valid.textureObjectKey(),
                        valid.thumbnailObjectKey(),
                        valid.meshFormat(),
                        valid.morphSchemaVersion(),
                        valid.measurements(),
                        valid.failCodes(),
                        valid.debugMessage(),
                        valid.qualityReport(),
                        valid.videoMeta(),
                        valid.durationMs(),
                        valid.captureImages(),
                        null,
                        review,
                        "c".repeat(64),
                        eyes);

        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn("model-1");
        when(finisher.succeed(any(), any(), any())).thenReturn(model);
        when(weightShapeApproval.validateForGeneration(PREFIX + "mesh.glb", null))
                .thenReturn("{weight}");
        when(eyeApproval.verifyAssets(PREFIX + "mesh.glb", PREFIX + "rig.json", review, eyes))
                .thenReturn(true);
        when(eyeApproval.approveWithVerifiedAssets("model-1", eyes)).thenReturn(true);

        assertThat(service.result(JOB, "w1", missing)).isEqualTo("model-1");
        verify(finisher).succeed(any(), any(), any());
        verify(noseEditService, never()).validateForGeneration(any(), any(), any());
        verify(model, never()).approveNose(any());
        verify(model).approveWeightShape("{weight}");
        InOrder order = inOrder(eyeApproval, finisher);
        order.verify(eyeApproval)
                .verifyAssets(PREFIX + "mesh.glb", PREFIX + "rig.json", review, eyes);
        order.verify(finisher).succeed(any(), any(), any());
        order.verify(eyeApproval).approveWithVerifiedAssets("model-1", eyes);
    }

    @Test
    void 코_승인이_실패하면_생성_성공을_반환하지_않는다() {
        running();
        FaceModel model =
                FaceModel.create(
                        USER,
                        JOB,
                        PREFIX + "mesh.glb",
                        PREFIX + "rig.json",
                        null,
                        null,
                        null,
                        "GLB",
                        "v1",
                        null);
        ReflectionTestUtils.setField(model, "id", "model-1");
        when(finisher.succeed(any(), any(), any())).thenReturn(model);
        doThrow(new BusinessException(com.preface.common.error.EditErrorCode.NOSE_EDIT_NOT_READY))
                .when(noseEditService)
                .validateForGeneration(any(), any(), any());

        assertCode(
                () ->
                        service.result(
                                JOB,
                                "w1",
                                succeeded(
                                        PREFIX + "mesh.glb",
                                        PREFIX + "rig.json",
                                        captures(PREFIX))),
                "EDIT_031");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 코_검사기_일시_장애에도_모델과_재시도_후보를_저장한다() {
        running();
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn("model-1");
        when(finisher.succeed(any(), any(), any())).thenReturn(model);
        doThrow(
                        new BusinessException(
                                com.preface.common.error.ReconstructionErrorCode
                                        .RESULT_CHECK_UNAVAILABLE))
                .when(noseEditService)
                .validateForGeneration(any(), any(), any());

        assertThat(
                        service.result(
                                JOB,
                                "w1",
                                succeeded(
                                        PREFIX + "mesh.glb",
                                        PREFIX + "rig.json",
                                        captures(PREFIX))))
                .isEqualTo("model-1");
        verify(model)
                .scheduleEditApprovalRetry(
                        org.mockito.ArgumentMatchers.contains("nose"),
                        org.mockito.ArgumentMatchers.eq(Instant.parse("2026-10-22T06:35:15Z")));
        verify(model, never()).approveNose(any());
        verify(finisher, never()).fail(any(), any(), any());
        verify(queue, never()).requeue(any());
    }

    @Test
    void 코_검증은_작업_행_잠금을_푼_뒤에_하고_저장할_때_다시_잠근다() {
        running();
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn("model-1");
        when(finisher.succeed(any(), any(), any())).thenReturn(model);
        when(noseEditService.validateForGeneration(any(), any(), any())).thenReturn("{approval}");
        when(weightShapeApproval.validateForGeneration(any(), any())).thenReturn("{weight}");

        assertThat(service.result(JOB, "w1", valid())).isEqualTo("model-1");

        InOrder order =
                inOrder(
                        jobRepository,
                        transactionManager,
                        noseEditService,
                        weightShapeApproval,
                        finisher,
                        model);
        order.verify(jobRepository).findByIdForUpdate(JOB);
        order.verify(transactionManager).commit(any());
        order.verify(noseEditService).validateForGeneration(any(), any(), any());
        order.verify(weightShapeApproval).validateForGeneration(PREFIX + "mesh.glb", "{approval}");
        order.verify(jobRepository).findByIdForUpdate(JOB);
        order.verify(finisher).succeed(any(), any(), any());
        order.verify(model).approveNose("{approval}");
        order.verify(model).approveWeightShape("{weight}");
        order.verify(transactionManager).commit(any());
    }

    @Test
    void 코_검증_중_취소되면_저장하지_않고_REC_020() {
        ReconstructionJob job = running();
        doAnswer(
                        inv -> {
                            job.cancel(Instant.now());
                            return "{approval}";
                        })
                .when(noseEditService)
                .validateForGeneration(any(), any(), any());

        assertCode(() -> service.result(JOB, "w1", valid()), "REC_020");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 코_검증_중_lease가_회수되면_저장하지_않고_REC_022() {
        ReconstructionJob job = running();
        doAnswer(
                        inv -> {
                            job.requeue();
                            return "{approval}";
                        })
                .when(noseEditService)
                .validateForGeneration(any(), any(), any());

        assertCode(() -> service.result(JOB, "w1", valid()), "REC_022");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 코_검증_중_다른_시도로_재배정되면_같은_워커여도_저장하지_않고_REC_022() {
        running();
        doAnswer(
                        inv -> {
                            when(queue.claim(JOB))
                                    .thenReturn(
                                            Optional.of(
                                                    new ReconstructionQueue.Claim(
                                                            "w1", Instant.now(), 2)));
                            return "{approval}";
                        })
                .when(noseEditService)
                .validateForGeneration(any(), any(), any());

        assertCode(() -> service.result(JOB, "w1", valid()), "REC_022");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 코_검증_중_claim_소유자가_지워지면_이전_시도_번호가_남아도_저장하지_않는다() {
        running();
        doAnswer(
                        inv -> {
                            when(queue.claim(JOB))
                                    .thenReturn(
                                            Optional.of(
                                                    new ReconstructionQueue.Claim(null, null, 1)));
                            return "{approval}";
                        })
                .when(noseEditService)
                .validateForGeneration(any(), any(), any());

        assertCode(() -> service.result(JOB, "w1", valid()), "REC_022");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 코_검증_중_같은_결과가_먼저_저장되면_그_모델을_돌려주고_다시_만들지_않는다() {
        ReconstructionJob job = running();
        FaceModel saved = mock(FaceModel.class);
        when(saved.getId()).thenReturn("model-1");
        when(faceModelRepository.findByReconstructionJobId(JOB)).thenReturn(Optional.of(saved));
        doAnswer(
                        inv -> {
                            job.succeed(Instant.now(), 1, null);
                            return "{approval}";
                        })
                .when(noseEditService)
                .validateForGeneration(any(), any(), any());

        assertThat(service.result(JOB, "w1", valid())).isEqualTo("model-1");
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 이미_성공한_작업의_재전송은_검증하지_않고_처음_모델을_돌려준다() {
        ReconstructionJob job = running();
        job.succeed(Instant.now(), 1, null);
        FaceModel saved = mock(FaceModel.class);
        when(saved.getId()).thenReturn("model-1");
        when(faceModelRepository.findByReconstructionJobId(JOB)).thenReturn(Optional.of(saved));

        assertThat(service.result(JOB, "w1", valid())).isEqualTo("model-1");
        verify(noseEditService, never()).validateForGeneration(any(), any(), any());
        verify(finisher, never()).succeed(any(), any(), any());
    }

    @Test
    void 끝난_작업에_진행_보고를_하면_중단을_알린다() {
        ReconstructionJob job = running();
        job.fail(Instant.now(), "[]", null, 1, null);

        assertThat(service.progress(JOB, "w1", new ProgressRequest("RUNNING", "FINALIZE", null)))
                .isFalse();
    }

    private ReconstructionJob running() {
        ReconstructionJob job = ReconstructionJob.queue(USER, "upload-1");
        ReflectionTestUtils.setField(job, "id", JOB);
        job.start(Instant.parse("2026-10-22T06:30:00Z"));
        when(jobRepository.findByIdForUpdate(JOB)).thenReturn(Optional.of(job));
        when(queue.claim(JOB))
                .thenReturn(Optional.of(new ReconstructionQueue.Claim("w1", Instant.now(), 1)));
        return job;
    }

    private static ResultRequest valid() {
        return succeeded(PREFIX + "mesh.glb", PREFIX + "rig.json", captures(PREFIX));
    }

    private static ResultRequest succeeded(String meshKey) {
        return succeeded(meshKey, captures(PREFIX));
    }

    private static ResultRequest succeeded(String meshKey, Map<String, String> captures) {
        return succeeded(meshKey, null, captures);
    }

    private static ResultRequest succeeded(
            String meshKey, String rigKey, Map<String, String> captures) {
        return new ResultRequest(
                "SUCCEEDED",
                meshKey,
                rigKey,
                null,
                null,
                "GLB",
                "v1",
                null,
                null,
                null,
                null,
                null,
                1,
                captures,
                new NoseApprovalRequest(
                        "v1",
                        new NoseApprovalRequest.Binding(
                                "a".repeat(64), "b".repeat(64), "fit", "engine", "v1", "topology"),
                        Map.of("nose.bridge_height", new NoseApprovalRequest.Range(-0.1, 0.1))));
    }

    private static Map<String, String> captures(String prefix) {
        Map<String, String> captures = new java.util.LinkedHashMap<>();
        for (CaptureAngle angle : CaptureAngle.values()) {
            captures.put(angle.name(), prefix + angle.fileName());
        }
        return captures;
    }

    private static ResultRequest failed(List<String> codes) {
        return new ResultRequest(
                "FAILED", null, null, null, null, null, null, null, codes, "x", null, null, null,
                null, null);
    }

    private static void assertCode(Runnable call, String code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(((ErrorCode) e.errorCode()).code()).isEqualTo(code));
    }
}
