package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.WeightShapeBackfillRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

class WeightShapeBackfillServiceTest {
    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final WeightShapeModelApprovalService shape =
            mock(WeightShapeModelApprovalService.class);
    private final NoseEditService nose = mock(NoseEditService.class);
    private final EyeEditService eye = mock(EyeEditService.class);
    private final WeightShapeBackfillCommitter committer = mock(WeightShapeBackfillCommitter.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private final WeightContourValidatorClient validator = mock(WeightContourValidatorClient.class);
    private final WeightShapeBackfillService service =
            new WeightShapeBackfillService(
                    models,
                    shape,
                    nose,
                    eye,
                    committer,
                    JsonMapper.builder().build(),
                    storage,
                    validator);
    private static final String OLD = "users/user/models/job/mesh.glb";
    private static final String NEW =
            "users/user/models/job/mesh-weight-shape-v1-aaaaaaaaaaaaaaaa.glb";
    private static final WeightShapeBackfillRequest REQUEST =
            new WeightShapeBackfillRequest(OLD, NEW, "b".repeat(64), "a".repeat(64));

    @Test
    void 광대_교체는_조합_형상에_실패하면_저장하지_않는다() throws Exception {
        FaceModel model = model(OLD);
        String next = "users/user/models/job/mesh-cheekbone-v1-" + REQUEST.newSha256() + ".glb";
        var request =
                new WeightShapeBackfillRequest(OLD, next, REQUEST.oldSha256(), REQUEST.newSha256());
        when(models.findById("model")).thenReturn(Optional.of(model));
        when(shape.cheekboneRepairPreservesAssets(
                        OLD, next, request.oldSha256(), request.newSha256()))
                .thenReturn(true);
        when(shape.contourMeshBinding(model))
                .thenReturn(
                        new WeightShapeModelApprovalService.MeshBinding(
                                request.oldSha256(), "d".repeat(12)));
        when(storage.presignGet(next))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://synthetic.invalid/model",
                                Map.of(),
                                java.time.Instant.EPOCH));
        assertThatThrownBy(() -> service.activateCheekboneRepair("model", request))
                .isInstanceOf(BusinessException.class);
        verify(validator)
                .validateFull(
                        "https://synthetic.invalid/model",
                        request.newSha256(),
                        "d".repeat(12),
                        Map.of("contour.cheekbone", -0.1, "contour.jaw_angle", -0.1),
                        null,
                        null,
                        null,
                        null,
                        null);
        verify(committer, never()).commitCheekboneRepair(any());
    }

    @Test
    void 코_승인이_없던_모델은_새_GLb_검증_뒤_코를_열지_않고_전환한다() {
        FaceModel model = model(OLD);
        when(models.findById("model")).thenReturn(Optional.of(model));
        when(shape.validateForBackfill(OLD, NEW, REQUEST.oldSha256(), REQUEST.newSha256()))
                .thenReturn("validated-weight");
        service.activate("model", REQUEST);
        ArgumentCaptor<WeightShapeBackfillCommitter.Proof> proof =
                ArgumentCaptor.forClass(WeightShapeBackfillCommitter.Proof.class);
        verify(committer).commit(proof.capture());
        org.assertj.core.api.Assertions.assertThat(proof.getValue().newNose()).isNull();
        org.assertj.core.api.Assertions.assertThat(proof.getValue().newWeight())
                .isEqualTo("validated-weight");
        verify(nose, never()).validateForGeneration(any(), any(), any());
    }

    @Test
    void 모델의_현재_메시나_키_결속이_다르면_자산을_검증하기_전에_거절한다() {
        when(models.findById("model")).thenReturn(Optional.of(model("other.glb")));
        assertThatThrownBy(() -> service.activate("model", REQUEST))
                .isInstanceOf(BusinessException.class);
        verify(shape, never()).validateForBackfill(any(), any(), any(), any());
        verify(committer, never()).commit(any());
    }

    @Test
    void 기존_코_승인이_있으면_새_메시_해시로_검증하고_함께_저장한다() throws Exception {
        FaceModel model =
                FaceModel.create(
                        "user", "job", OLD, "rig.glb", null, null, null, "GLB", "v2", null);
        model.approveNose(
                "{\"schemaVersion\":\"v2\",\"binding\":{\"meshSha256\":\""
                        + REQUEST.oldSha256()
                        + "\",\"rigSha256\":\""
                        + "c".repeat(64)
                        + "\",\"fitSha\":\""
                        + "d".repeat(12)
                        + "\",\"engine\":\"engine\",\"rigVersion\":\"v1\","
                        + "\"topologyVersion\":\"v1\"},\"ranges\":{\"nose.alar_width\":{\"min\":-0.2,\"max\":0.2}}}");
        when(models.findById("model")).thenReturn(Optional.of(model));
        when(shape.validateForBackfill(OLD, NEW, REQUEST.oldSha256(), REQUEST.newSha256()))
                .thenReturn(
                        JsonMapper.builder()
                                .build()
                                .writeValueAsString(
                                        new WeightShapeModelApprovalService.Approval(
                                                1,
                                                REQUEST.newSha256(),
                                                "d".repeat(12),
                                                1,
                                                1,
                                                1,
                                                NEW)));
        when(nose.validateForGeneration(any(), any(), any())).thenReturn("new-nose");
        service.activate("model", REQUEST);
        ArgumentCaptor<NoseApprovalRequest> noseRequest =
                ArgumentCaptor.forClass(NoseApprovalRequest.class);
        verify(nose)
                .validateForGeneration(
                        org.mockito.ArgumentMatchers.eq(NEW),
                        org.mockito.ArgumentMatchers.eq("rig.glb"),
                        noseRequest.capture());
        org.assertj.core.api.Assertions.assertThat(noseRequest.getValue().binding().meshSha256())
                .isEqualTo(REQUEST.newSha256());
        org.assertj.core.api.Assertions.assertThat(noseRequest.getValue().ranges())
                .isEqualTo(Map.of("nose.alar_width", new NoseApprovalRequest.Range(-0.2, 0.2)));
        ArgumentCaptor<WeightShapeBackfillCommitter.Proof> proof =
                ArgumentCaptor.forClass(WeightShapeBackfillCommitter.Proof.class);
        verify(committer).commit(proof.capture());
        org.assertj.core.api.Assertions.assertThat(proof.getValue().newNose())
                .isEqualTo("new-nose");
    }

    private static FaceModel model(String mesh) {
        return FaceModel.create("user", "job", mesh, null, null, null, null, "GLB", "v2", null);
    }
}
