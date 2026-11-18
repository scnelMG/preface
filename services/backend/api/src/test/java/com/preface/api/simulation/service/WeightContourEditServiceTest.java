package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.MorphState;
import com.preface.common.error.BusinessException;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.simulation.entity.Simulation;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class WeightContourEditServiceTest {
    private static final String MESH_SHA = "a".repeat(64);
    private static final String FIT_SHA = "b".repeat(12);
    private static final String APPROVAL =
            "{\"version\":1,\"meshSha256\":\""
                    + MESH_SHA
                    + "\",\"fitSha\":\""
                    + FIT_SHA
                    + "\",\"modelVersion\":1,\"negativeLimit\":1,\"positiveLimit\":1}";
    private final WeightShapeEditGuard guard = mock(WeightShapeEditGuard.class);
    private final WeightShapeModelApprovalService contour =
            mock(WeightShapeModelApprovalService.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private final WeightContourValidatorClient validator = mock(WeightContourValidatorClient.class);
    private final FaceModel model = mock(FaceModel.class);
    private final Simulation simulation = Simulation.create("user", "model", "시안", "{}");
    private final WeightContourEditService service =
            new WeightContourEditService(
                    guard, contour, storage, validator, JsonMapper.builder().build());

    @Test
    void 승인된_모델의_최종_메시가_안전할_때만_정확한_가중치_증명을_만든다() {
        when(model.getId()).thenReturn("model");
        when(model.getMeshObjectKey()).thenReturn("synthetic.glb");
        when(model.getApprovedWeightShape()).thenReturn(APPROVAL);
        when(contour.supportedContourCodes(model)).thenReturn(Set.of("contour.cheek_volume"));
        when(storage.presignGet("synthetic.glb"))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/mesh", Map.of(), Instant.now()));
        Map<String, Double> weights =
                Map.of("contour.weight_shape", -0.4, "contour.cheek_volume", 0.2);
        MorphState state = new MorphState("v2", weights);
        when(guard.requireEligible(simulation, state)).thenReturn(model);
        when(validator.validate("https://example.invalid/mesh", MESH_SHA, FIT_SHA, weights))
                .thenReturn(true);

        WeightShapeEditGuard.Proof proof = service.prepare(simulation, state);
        assertThat(proof.weights()).isEqualTo(weights);
        assertThat(proof.meshObjectKey()).isEqualTo("synthetic.glb");
        assertThat(
                        service.prepare(
                                simulation,
                                new MorphState("v2", Map.of("contour.weight_shape", -0.4))))
                .isNull();
        verify(validator).validate("https://example.invalid/mesh", MESH_SHA, FIT_SHA, weights);
    }

    @Test
    void 검사기가_실패하거나_윤곽_타깃이_없으면_저장_증명을_만들지_않는다() {
        when(model.getId()).thenReturn("model");
        when(model.getMeshObjectKey()).thenReturn("synthetic.glb");
        when(model.getApprovedWeightShape()).thenReturn(APPROVAL);
        when(guard.requireEligible(eq(simulation), any(MorphState.class))).thenReturn(model);
        MorphState state =
                new MorphState(
                        "v2", Map.of("contour.weight_shape", -0.4, "contour.cheek_volume", 0.2));
        when(contour.supportedContourCodes(model)).thenReturn(Set.of());
        assertThatThrownBy(() -> service.prepare(simulation, state))
                .isInstanceOf(BusinessException.class);
        verify(validator, never()).validate(any(), any(), any(), any());
        when(contour.supportedContourCodes(model)).thenReturn(Set.of("contour.cheek_volume"));
        when(storage.presignGet("synthetic.glb"))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/mesh", Map.of(), Instant.now()));
        when(validator.validate(
                        eq("https://example.invalid/mesh"), eq(MESH_SHA), eq(FIT_SHA), any()))
                .thenReturn(false);
        assertThatThrownBy(() -> service.prepare(simulation, state))
                .isInstanceOf(BusinessException.class);
    }
}
