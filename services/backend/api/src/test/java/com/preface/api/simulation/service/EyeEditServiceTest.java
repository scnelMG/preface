package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.EyeEditState;
import com.preface.common.error.BusinessException;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.Simulation;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

class EyeEditServiceTest {
    private static final String SHA = "a".repeat(64);
    private static final String RIG_SHA = "b".repeat(64);
    private static final String PARTS_SHA = "c".repeat(64);
    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private final EyeEditValidatorClient validator = mock(EyeEditValidatorClient.class);
    private final EyeEditService service =
            new EyeEditService(models, storage, validator, JsonMapper.builder().build());
    private final Simulation simulation = mock(Simulation.class);

    @Test
    void 눈_판정이나_승인_범위가_없으면_눈_상태를_저장하지_않는다() {
        FaceModel model = model("{\"R\":\"absent\",\"L\":\"absent\"}", null);
        assertThat(service.support("model").review().known()).isTrue();
        assertThat(service.support("model").capabilities()).isNull();
        assertThatThrownBy(() -> service.validate(simulation, EyeEditState.initial()))
                .isInstanceOf(BusinessException.class);
        when(model.getEyeReview()).thenReturn(null);
        assertThat(service.support("model").review()).isNull();
    }

    @Test
    void 승인된_모델은_양쪽_트임을_저장하고_쌍꺼풀_있는_눈에는_새_라인을_막는다() {
        model("{\"R\":\"present\",\"L\":\"absent\"}", limits(SHA));
        EyeEditState initial = EyeEditState.initial();
        EyeEditState.EyeSettings left =
                new EyeEditState.EyeSettings(
                        false,
                        "inout",
                        new EyeEditState.Values(20, 65, 15, 0, 0, 0),
                        initial.L().curve());
        EyeEditState.EyeSettings right =
                new EyeEditState.EyeSettings(
                        false,
                        "inout",
                        new EyeEditState.Values(20, 65, 15, 0, 0, 0),
                        initial.R().curve());
        EyeEditState allowed = new EyeEditState(left, right);
        assertThat(service.validate(simulation, allowed)).isEqualTo(allowed);
        EyeEditState unsupported =
                new EyeEditState(
                        left,
                        new EyeEditState.EyeSettings(true, "inout", right.values(), right.curve()));
        assertThatThrownBy(() -> service.validate(simulation, unsupported))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void 메시_해시가_다른_승인과_범위_초과는_저장하지_않는다() {
        model("{\"R\":\"absent\",\"L\":\"absent\"}", limits("d".repeat(64)));
        assertThat(service.support("model").capabilities()).isNull();
        model(
                "{\"R\":\"absent\",\"L\":\"absent\"}",
                limits(SHA).replace(PARTS_SHA, "e".repeat(64)));
        assertThat(service.support("model").capabilities()).isNull();
        model(
                "{\"R\":\"absent\",\"L\":\"absent\"}",
                limits(SHA).replace("\"engine\":\"v1\"", "\"engine\":\"v2\""));
        assertThat(service.support("model").capabilities()).isNull();
        model("{\"R\":\"absent\",\"L\":\"absent\"}", limits(SHA));
        EyeEditState initial = EyeEditState.initial();
        EyeEditState.EyeSettings excessive =
                new EyeEditState.EyeSettings(
                        false,
                        "inout",
                        new EyeEditState.Values(20, 65, 21, 0, 0, 0),
                        initial.L().curve());
        assertThatThrownBy(
                        () ->
                                service.validate(
                                        simulation, new EyeEditState(excessive, initial.R())))
                .isInstanceOf(BusinessException.class);
        EyeEditState.EyeSettings alteredCurve =
                new EyeEditState.EyeSettings(
                        false, "inout", initial.L().values(), List.of(0.2, 0.2, 0.2, 0.2, 0.2));
        assertThatThrownBy(
                        () ->
                                service.validate(
                                        simulation, new EyeEditState(alteredCurve, initial.R())))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void 생성_결과의_눈_승인은_코_결속과_판정_해시가_같을_때만_저장한다() {
        FaceModel model = model("{\"R\":\"present\",\"L\":\"absent\"}", null);
        Map<String, Double> limits =
                Map.of(
                        "inner",
                        100.0,
                        "outer",
                        70.0,
                        "lower",
                        100.0,
                        "upper",
                        40.0,
                        "inout:height",
                        60.0);
        assertThat(service.approveForGeneration("model", approval(SHA, PARTS_SHA, "v1", limits)))
                .isTrue();
        ArgumentCaptor<String> stored = ArgumentCaptor.forClass(String.class);
        verify(model).approveEyes(stored.capture());
        when(model.getApprovedEyeCapabilities()).thenReturn(stored.getValue());
        assertThat(service.support("model").capabilities().limits()).isEqualTo(limits);
        assertThat(service.support("model").capabilities().eyePartsSha256()).isEqualTo(PARTS_SHA);
    }

    @Test
    void 코_승인_없이도_자산과_눈_판정이_확인되면_눈을_연다() {
        FaceModel model = model("{\"R\":\"present\",\"L\":\"absent\"}", null);
        when(model.getApprovedNoseCapabilities()).thenReturn(null);
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://synthetic.invalid/model",
                                Map.of(),
                                java.time.Instant.now()));
        var request =
                approval(
                        SHA,
                        PARTS_SHA,
                        "v1",
                        Map.of("inner", 100.0, "outer", 70.0, "lower", 100.0, "upper", 40.0));
        var review = new com.preface.api.simulation.dto.EyeReview("present", "absent");
        var binding = new EyeEditValidatorClient.EyeCapabilitiesBinding(SHA, RIG_SHA, PARTS_SHA);
        when(validator.validate(
                        "https://synthetic.invalid/model",
                        "https://synthetic.invalid/model",
                        binding,
                        review,
                        EyeEditState.initial()))
                .thenReturn(true);

        assertThat(service.approveForGeneration("model", request)).isFalse();
        assertThat(
                        service.verifyAssets(
                                "mesh", "rig", Map.of("R", "present", "L", "absent"), request))
                .isTrue();
        assertThat(service.approveWithVerifiedAssets("model", request)).isTrue();
        var stored = ArgumentCaptor.forClass(String.class);
        verify(model).approveEyes(stored.capture());
        when(model.getApprovedEyeCapabilities()).thenReturn(stored.getValue());
        assertThat(service.support("model").capabilities().limits()).isEqualTo(request.limits());
    }

    @Test
    void 결속_판정_한계가_맞지_않는_눈_승인은_저장하지_않는다() {
        Map<String, Double> trims =
                Map.of("inner", 100.0, "outer", 70.0, "lower", 100.0, "upper", 40.0);
        Map<String, Double> unknownKey = new java.util.HashMap<>(trims);
        unknownKey.put("tail", 10.0);
        Map<String, Double> over = new java.util.HashMap<>(trims);
        over.put("inner", 101.0);
        Map<String, Double> notFinite = new java.util.HashMap<>(trims);
        notFinite.put("upper", Double.NaN);
        Map<String, Double> missingTrim = new java.util.HashMap<>(trims);
        missingTrim.remove("lower");
        List<EyeApprovalRequest> rejected =
                List.of(
                        approval("d".repeat(64), PARTS_SHA, "v1", trims),
                        approval(SHA, "e".repeat(64), "v1", trims),
                        approval(SHA, PARTS_SHA, "v2", trims),
                        approval(SHA, PARTS_SHA, "v1", unknownKey),
                        approval(SHA, PARTS_SHA, "v1", over),
                        approval(SHA, PARTS_SHA, "v1", notFinite),
                        approval(SHA, PARTS_SHA, "v1", missingTrim));
        FaceModel model = model("{\"R\":\"absent\",\"L\":\"absent\"}", null);
        for (EyeApprovalRequest request : rejected) {
            assertThat(service.approveForGeneration("model", request)).isFalse();
        }
        assertThat(service.approveForGeneration("model", null)).isFalse();
        when(model.getEyeReview()).thenReturn(null);
        assertThat(service.approveForGeneration("model", approval(SHA, PARTS_SHA, "v1", trims)))
                .isFalse();
        when(model.getEyeReview()).thenReturn("{\"R\":\"absent\",\"L\":\"unknown\"}");
        assertThat(service.approveForGeneration("model", approval(SHA, PARTS_SHA, "v1", trims)))
                .isFalse();
        verify(model, never()).approveEyes(any());
    }

    @Test
    void 눈_전체_형상이_불안전하거나_검사기가_실패하면_저장_증명을_만들지_않는다() {
        model("{\"R\":\"absent\",\"L\":\"absent\"}", limits(SHA));
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://synthetic.invalid/model",
                                Map.of(),
                                java.time.Instant.now()));
        EyeEditState state = EyeEditState.initial();
        when(validator.validate(anyString(), anyString(), any(), any(), any())).thenReturn(false);
        assertThatThrownBy(() -> service.prepare(simulation, state))
                .isInstanceOf(BusinessException.class);
        when(validator.validate(anyString(), anyString(), any(), any(), any()))
                .thenThrow(new EyeEditValidatorClient.InvalidResult());
        assertThatThrownBy(() -> service.prepare(simulation, state))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void 검증_후_승인이나_객체_키가_바뀌면_저장_직전_증명을_거절한다() {
        FaceModel model = model("{\"R\":\"absent\",\"L\":\"absent\"}", limits(SHA));
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://synthetic.invalid/model",
                                Map.of(),
                                java.time.Instant.now()));
        when(validator.validate(anyString(), anyString(), any(), any(), any())).thenReturn(true);
        EyeEditState state = EyeEditState.initial();
        EyeEditService.Proof proof = service.prepare(simulation, state);
        assertThat(service.validatePrepared(simulation, state, proof)).isEqualTo(state);
        when(model.getRigObjectKey()).thenReturn("changed-rig");
        assertThatThrownBy(() -> service.validatePrepared(simulation, state, proof))
                .isInstanceOf(BusinessException.class);
        when(model.getRigObjectKey()).thenReturn("rig");
        when(model.getApprovedEyeCapabilities()).thenReturn(limits("d".repeat(64)));
        assertThatThrownBy(() -> service.validatePrepared(simulation, state, proof))
                .isInstanceOf(BusinessException.class);
    }

    private static EyeApprovalRequest approval(
            String meshSha, String partsSha, String schema, Map<String, Double> limits) {
        return new EyeApprovalRequest(
                schema,
                new EyeApprovalRequest.Binding(meshSha, RIG_SHA, partsSha, "v1", "v1", "v1"),
                limits);
    }

    private FaceModel model(String review, String eyeCapabilities) {
        FaceModel model = mock(FaceModel.class);
        when(simulation.getFaceModelId()).thenReturn("model");
        when(model.getEyeReview()).thenReturn(review);
        when(model.getId()).thenReturn("model");
        when(model.getMeshObjectKey()).thenReturn("mesh");
        when(model.getRigObjectKey()).thenReturn("rig");
        when(model.getEyePartsSha256()).thenReturn(PARTS_SHA);
        when(model.getMorphSchemaVersion()).thenReturn("v1");
        when(model.getApprovedEyeCapabilities()).thenReturn(eyeCapabilities);
        when(model.getApprovedNoseCapabilities())
                .thenReturn(
                        "{\"schemaVersion\":\"v1\",\"binding\":{\"meshSha256\":\""
                                + SHA
                                + "\",\"rigSha256\":\""
                                + RIG_SHA
                                + "\",\"fitSha\":\"fit\",\"engine\":\"v1\",\"rigVersion\":\"v1\",\"topologyVersion\":\"v1\"},\"ranges\":{}}");
        when(models.findById("model")).thenReturn(Optional.of(model));
        return model;
    }

    private static String limits(String sha) {
        return "{\"schemaVersion\":\"v1\",\"meshSha256\":\""
                + sha
                + "\",\"rigSha256\":\""
                + RIG_SHA
                + "\",\"eyePartsSha256\":\""
                + PARTS_SHA
                + "\",\"engine\":\"v1\",\"rigVersion\":\"v1\",\"topologyVersion\":\"v1\",\"limits\":{\"inner\":20,\"outer\":20,\"lower\":20,\"upper\":20,\"inout:height\":40}}";
    }
}
