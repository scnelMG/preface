package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.MorphState;
import com.preface.api.simulation.dto.PointStroke;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.Simulation;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class WeightShapeEditGuardTest {
    private static final String MESH = "a".repeat(64);
    private static final String FIT = "c".repeat(12);
    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final FaceModel model = mock(FaceModel.class);
    private final WeightShapeEditGuard guard =
            new WeightShapeEditGuard(models, JsonMapper.builder().build());
    private final Simulation simulation = Simulation.create("user", "model", "시안", "{}");

    @BeforeEach
    void setUp() {
        when(models.findById("model")).thenReturn(Optional.of(model));
        when(model.getId()).thenReturn("model");
        when(model.getMeshObjectKey()).thenReturn("synthetic.glb");
        when(model.getMeshFormat()).thenReturn("GLB");
        when(model.getMorphSchemaVersion()).thenReturn("v2");
        when(model.getApprovedWeightShape())
                .thenReturn(
                        "{\"version\":1,\"meshSha256\":\""
                                + MESH
                                + "\",\"fitSha\":\""
                                + FIT
                                + "\","
                                + "\"modelVersion\":1,\"negativeLimit\":1,\"positiveLimit\":0.75}");
        when(model.getApprovedNoseCapabilities())
                .thenReturn(
                        "{\"schemaVersion\":\"v2\",\"binding\":{\"meshSha256\":\""
                                + MESH
                                + "\",\"rigSha256\":\"rig\",\"fitSha\":\""
                                + FIT
                                + "\",\"engine\":\"engine\","
                                + "\"rigVersion\":\"v1\",\"topologyVersion\":\"v1\"},\"ranges\":{}}");
    }

    @Test
    void 승인된_모델의_양방향_단독_얼굴형은_저장할_수_있다() {
        assertThat(guard.supported("model")).isTrue();
        guard.requireSafe(simulation, state(-0.4));
        guard.requireSafe(simulation, state(0.6));
        guard.requireSafe(simulation, state(0));
    }

    @Test
    void 승인_결속이_없거나_다르면_얼굴형_저장을_거절한다() {
        when(model.getApprovedWeightShape()).thenReturn(null);
        assertThat(guard.supported("model")).isFalse();
        rejected(state(0.4));
        when(model.getApprovedWeightShape())
                .thenReturn(
                        "{\"version\":1,\"meshSha256\":\""
                                + "d".repeat(64)
                                + "\",\"fitSha\":\""
                                + FIT
                                + "\","
                                + "\"modelVersion\":1,\"negativeLimit\":1,\"positiveLimit\":1}");
        rejected(state(0.4));
    }

    @Test
    void 코_승인이_없는_과거_모델도_새_메시_키에_결속되면_얼굴형을_저장한다() {
        String key = "users/synthetic/models/synthetic/mesh-weight-shape-v1-aaaaaaaaaaaaaaaa.glb";
        when(model.getApprovedNoseCapabilities()).thenReturn(null);
        when(model.getMeshObjectKey()).thenReturn(key);
        when(model.getSourceMeshObjectKey())
                .thenReturn("users/synthetic/models/synthetic/mesh.glb");
        when(model.getApprovedWeightShape())
                .thenReturn(
                        "{\"version\":1,\"meshSha256\":\""
                                + MESH
                                + "\",\"fitSha\":\""
                                + FIT
                                + "\",\"modelVersion\":1,\"negativeLimit\":1,\"positiveLimit\":1,"
                                + "\"meshObjectKey\":\""
                                + key
                                + "\"}");
        assertThat(guard.supported("model")).isTrue();
        guard.requireSafe(simulation, state(-0.4));
        when(model.getMeshObjectKey()).thenReturn("other.glb");
        rejected(state(0.4));
    }

    @Test
    void 다른_부위나_눈과_함께_적용하는_상태는_거절한다() {
        rejected(new MorphState("v2", Map.of("contour.weight_shape", 0.4, "nose.alar_width", 0.2)));
        rejected(
                new MorphState(
                        "v2",
                        Map.of("contour.weight_shape", 0.4),
                        List.of(new PointStroke(1, List.of(0.01, 0.0, 0.0))),
                        null));
        guard.requireSafe(
                simulation,
                new MorphState(
                        "v2",
                        Map.of("contour.weight_shape", 0.4),
                        List.of(),
                        EyeEditState.initial()));
        rejected(
                new MorphState(
                        "v2",
                        Map.of("contour.weight_shape", 0.4),
                        List.of(),
                        new EyeEditState(
                                new EyeEditState.EyeSettings(
                                        true,
                                        "inout",
                                        EyeEditState.initial().L().values(),
                                        EyeEditState.initial().L().curve()),
                                EyeEditState.initial().R())));
    }

    @Test
    void 새_복합_편집은_거절하지만_검사된_기존_복합_상태는_복원할_수_있다() {
        MorphState combined =
                new MorphState(
                        "v2", Map.of("contour.weight_shape", -0.4, "contour.cheek_volume", 0.2));
        assertThatThrownBy(() -> WeightShapeEditGuard.requireExclusive(combined))
                .isInstanceOf(BusinessException.class);
        WeightShapeEditGuard.Proof proof =
                new WeightShapeEditGuard.Proof(
                        simulation.getId(),
                        simulation.getStateVersion(),
                        "model",
                        "synthetic.glb",
                        model.getApprovedWeightShape(),
                        "v2",
                        combined.weights());
        guard.requireSafe(simulation, combined, proof);
        assertThatThrownBy(
                        () ->
                                guard.requireSafe(
                                        simulation,
                                        new MorphState(
                                                "v2",
                                                Map.of(
                                                        "contour.weight_shape", -0.4,
                                                        "contour.cheek_volume", 0.3)),
                                        proof))
                .isInstanceOf(BusinessException.class);
        when(model.getApprovedWeightShape()).thenReturn("other approval");
        assertThatThrownBy(() -> guard.requireSafe(simulation, combined, proof))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void 네_편집의_상태와_모델_승인이_검사_이후_같아야_저장한다() {
        EyeEditState eyes =
                new EyeEditState(
                        new EyeEditState.EyeSettings(
                                true,
                                "inout",
                                EyeEditState.initial().L().values(),
                                EyeEditState.initial().L().curve()),
                        EyeEditState.initial().R());
        MorphState combined =
                new MorphState(
                        "v2",
                        Map.of(
                                "contour.weight_shape",
                                -0.4,
                                "contour.cheek_volume",
                                0.2,
                                "nose.alar_width",
                                0.1),
                        List.of(),
                        eyes);
        var proof =
                new WeightShapeEditGuard.Proof(
                        simulation.getId(),
                        simulation.getStateVersion(),
                        model.getId(),
                        model.getMeshObjectKey(),
                        model.getApprovedWeightShape(),
                        combined.schemaVersion(),
                        combined.weights(),
                        WeightShapeEditGuard.FullBinding.of(model, eyes));
        guard.requireSafe(simulation, combined, proof);
        when(model.getRigObjectKey()).thenReturn("another-rig.json");
        assertThatThrownBy(() -> guard.requireSafe(simulation, combined, proof))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void 검사_뒤_시안_버전이_변하거나_다른_시안이면_증명을_재사용하지_못한다() {
        MorphState combined =
                new MorphState(
                        "v2", Map.of("contour.weight_shape", -0.4, "contour.cheek_volume", 0.2));
        WeightShapeEditGuard.Proof otherSimulation =
                new WeightShapeEditGuard.Proof(
                        "other",
                        simulation.getStateVersion(),
                        "model",
                        "synthetic.glb",
                        model.getApprovedWeightShape(),
                        "v2",
                        combined.weights());
        assertThatThrownBy(() -> guard.requireSafe(simulation, combined, otherSimulation))
                .isInstanceOf(BusinessException.class);
        WeightShapeEditGuard.Proof oldVersion =
                new WeightShapeEditGuard.Proof(
                        simulation.getId(),
                        -1,
                        "model",
                        "synthetic.glb",
                        model.getApprovedWeightShape(),
                        "v2",
                        combined.weights());
        assertThatThrownBy(() -> guard.requireSafe(simulation, combined, oldVersion))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void 승인_범위가_잘못되거나_저장값이_범위를_넘으면_거절한다() {
        rejected(state(1.2));
        when(model.getApprovedWeightShape())
                .thenReturn(
                        "{\"version\":1,\"meshSha256\":\""
                                + MESH
                                + "\",\"fitSha\":\""
                                + FIT
                                + "\","
                                + "\"modelVersion\":1,\"negativeLimit\":0,\"positiveLimit\":1}");
        rejected(state(0.4));
    }

    private static MorphState state(double weight) {
        return new MorphState("v2", Map.of("contour.weight_shape", weight));
    }

    private void rejected(MorphState state) {
        assertThatThrownBy(() -> guard.requireSafe(simulation, state))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(EditErrorCode.UNKNOWN_MORPH_CODE));
    }
}
