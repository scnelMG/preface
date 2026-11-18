package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.Simulation;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

class NoseEditServiceTest {

    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private final NoseEditValidatorClient validator = mock(NoseEditValidatorClient.class);
    private final MorphParameterService parameters = mock(MorphParameterService.class);
    private final NoseEditService service =
            new NoseEditService(
                    models,
                    storage,
                    validator,
                    JsonMapper.builder().build(),
                    parameters,
                    new TransactionTemplate(mock(PlatformTransactionManager.class)));
    private final FaceModel model = mock(FaceModel.class);
    private final Simulation simulation = Simulation.create("user", "model", "시안", "{}");
    private final Map<String, MorphRange> catalog =
            Map.of("nose.bridge_height", new MorphRange("nose.bridge_height", "콧대", -1, 1));

    @BeforeEach
    void setUp() {
        when(models.findById("model")).thenReturn(Optional.of(model));
    }

    @Test
    void 승인_정보가_없으면_검사기를_호출하지_않고_편집을_거절한다() {
        assertThat(service.capabilities(simulation, catalog)).isNull();
        assertThatThrownBy(() -> validate(false))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e ->
                                assertThat(e.errorCode())
                                        .isEqualTo(EditErrorCode.NOSE_EDIT_NOT_READY));
        verifyNoInteractions(storage, validator);
    }

    @Test
    void 모델과_승인된_편집_스키마_버전이_다르면_편집을_거절한다() {
        ready(
                "{\"schemaVersion\":\"v1\",\"binding\":{\"meshSha256\":\"mesh\",\"rigSha256\":\"rig\",\"fitSha\":\"fit\",\"engine\":\"engine\",\"rigVersion\":\"v1\",\"topologyVersion\":\"topology\"},\"ranges\":{\"nose.bridge_height\":{\"min\":-0.4,\"max\":0.6}}}");

        assertThat(service.capabilities(simulation, catalog)).isNull();
        assertThatThrownBy(() -> validate(false))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e ->
                                assertThat(e.errorCode())
                                        .isEqualTo(EditErrorCode.NOSE_EDIT_NOT_READY));
        verifyNoInteractions(storage, validator);
    }

    @Test
    void 승인된_범위와_결속으로_검사한_실제값만_반환한다() {
        ready(
                "{\"schemaVersion\":\"v2\",\"binding\":{\"meshSha256\":\"mesh\",\"rigSha256\":\"rig\",\"fitSha\":\"fit\",\"engine\":\"engine\",\"rigVersion\":\"v1\",\"topologyVersion\":\"topology\"},\"ranges\":{\"nose.bridge_height\":{\"min\":-0.4,\"max\":0.6}}}");
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        when(validator.validate(
                        anyString(),
                        anyString(),
                        eq(
                                new NoseEditValidation.Binding(
                                        "mesh", "rig", "fit", "engine", "v1", "topology")),
                        anyMap(),
                        anyMap(),
                        anyMap(),
                        any(),
                        any()))
                .thenReturn(
                        new NoseEditValidation.Checked(
                                Map.of("nose.bridge_height", 0.35), List.of()));

        MorphEdits.Applied applied = validate(false);

        assertThat(applied.weights()).containsEntry("nose.bridge_height", 0.35);
        assertThat(applied.changes().getFirst().to()).isEqualTo(0.35);
        assertThat(applied.clamped()).isTrue();
        assertThat(service.capabilities(simulation, catalog).supported())
                .containsEntry(
                        "nose.bridge_height",
                        new com.preface.api.simulation.dto.NoseCapabilities.Range(-0.4, 0.6));
    }

    @Test
    void 요청값이_모델_범위를_넘으면_검사_전에_끝값으로_제한한다() {
        ready(
                "{\"schemaVersion\":\"v2\",\"binding\":{\"meshSha256\":\"mesh\",\"rigSha256\":\"rig\",\"fitSha\":\"fit\",\"engine\":\"engine\",\"rigVersion\":\"v1\",\"topologyVersion\":\"topology\"},\"ranges\":{\"nose.bridge_height\":{\"min\":-0.25,\"max\":0.4}}}");
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        when(validator.validate(
                        anyString(),
                        anyString(),
                        any(),
                        anyMap(),
                        anyMap(),
                        anyMap(),
                        any(),
                        any()))
                .thenAnswer(inv -> new NoseEditValidation.Checked(inv.getArgument(5), List.of()));
        MorphEdits.Applied requested =
                MorphEdits.apply(
                        Map.of(),
                        List.of(new MorphEdits.Requested("nose.bridge_height", 0.8)),
                        catalog);

        MorphEdits.Applied applied =
                service.validate(simulation, Map.of(), requested, catalog, true);

        verify(validator)
                .validate(
                        anyString(),
                        anyString(),
                        any(),
                        anyMap(),
                        anyMap(),
                        eq(Map.of("nose.bridge_height", 0.4)),
                        any(),
                        any());
        assertThat(applied.weights()).containsEntry("nose.bridge_height", 0.4);
        assertThat(applied.clamped()).isTrue();
    }

    @Test
    void 승인_범위가_공통_범위를_넘으면_검사_전_거절한다() {
        ready(
                "{\"schemaVersion\":\"v2\",\"binding\":{},\"ranges\":{\"nose.bridge_height\":{\"min\":-2,\"max\":1}}}");
        assertThatThrownBy(() -> validate(true))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e ->
                                assertThat(e.errorCode())
                                        .isEqualTo(EditErrorCode.CHAT_APPLY_NOT_SUPPORTED));
        verifyNoInteractions(storage, validator);
    }

    @Test
    void 원본과_리그_및_승인_범위_끝값을_검사한_뒤에만_모델을_연다() {
        ready(null);
        when(model.getUserId()).thenReturn("user");
        when(models.findOwnedForUpdate("model", "user")).thenReturn(Optional.of(model));
        when(parameters.ranges("v2")).thenReturn(catalog);
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        when(validator.validate(anyString(), anyString(), any(), anyMap(), anyMap(), anyMap()))
                .thenAnswer(inv -> inv.getArgument(5));
        NoseApprovalRequest request = approvalRequest();

        assertThat(service.approve("model", request).supported()).containsKey("nose.bridge_height");
        verify(model).approveNose(anyString());
    }

    @Test
    void 끝값이_안전하지_않으면_모델을_열지_않는다() {
        ready(null);
        when(parameters.ranges("v2")).thenReturn(catalog);
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        when(validator.validate(anyString(), anyString(), any(), anyMap(), anyMap(), anyMap()))
                .thenReturn(Map.of());

        assertThatThrownBy(() -> service.approve("model", approvalRequest()))
                .isInstanceOf(BusinessException.class);
        verify(model, never()).approveNose(anyString());
    }

    @Test
    void 신규_생성에서_한쪽만_승인된_효과는_그_끝값만_검사한다() {
        String code = "nose.bridge_height";
        var request =
                new NoseApprovalRequest(
                        "v2",
                        approvalRequest().binding(),
                        Map.of(code, new NoseApprovalRequest.Range(0.0, 0.6)));
        when(parameters.ranges("v2")).thenReturn(catalog);
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        when(validator.validate(anyString(), anyString(), any(), anyMap(), anyMap(), anyMap()))
                .thenAnswer(inv -> inv.getArgument(5));

        assertThat(service.validateForGeneration("mesh", "rig", request)).contains(code);

        verify(validator, times(2))
                .validate(anyString(), anyString(), any(), anyMap(), anyMap(), anyMap());
        verifyNoInteractions(models);
    }

    @Test
    void 신규_생성은_공통_범위와_겹치는_끝값만_검사하고_승인한다() {
        String bridge = "nose.bridge_height";
        String tip = "nose.tip_height";
        var request =
                new NoseApprovalRequest(
                        "v2",
                        approvalRequest().binding(),
                        Map.of(
                                bridge, new NoseApprovalRequest.Range(-1.0, 1.0),
                                tip, new NoseApprovalRequest.Range(-0.4, 0.0)));
        var expected = Map.of(bridge, new MorphRange(bridge, "콧대", -0.5, 0.8));
        when(parameters.ranges("v2"))
                .thenReturn(
                        Map.of(
                                bridge,
                                expected.get(bridge),
                                tip,
                                new MorphRange(tip, "코끝", 0, 0.5)));
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        when(validator.validate(
                        anyString(), anyString(), any(), eq(expected), eq(Map.of()), anyMap()))
                .thenAnswer(inv -> inv.getArgument(5));

        String approval = service.validateForGeneration("mesh", "rig", request);

        assertThat(
                        JsonMapper.builder()
                                .build()
                                .readValue(approval, NoseEditService.Approval.class)
                                .ranges())
                .containsExactlyEntriesOf(Map.of(bridge, new NoseEditService.Bounds(-0.5, 0.8)));
        verify(validator)
                .validate(
                        anyString(), anyString(), any(), eq(expected), eq(Map.of()), eq(Map.of()));
        verify(validator)
                .validate(
                        anyString(),
                        anyString(),
                        any(),
                        eq(expected),
                        eq(Map.of()),
                        eq(Map.of(bridge, -0.5)));
        verify(validator)
                .validate(
                        anyString(),
                        anyString(),
                        any(),
                        eq(expected),
                        eq(Map.of()),
                        eq(Map.of(bridge, 0.8)));
        verifyNoInteractions(models);
    }

    @Test
    void 신규_생성_검증은_DB를_건드리지_않고_끝값마다_검사기를_불러_승인_JSON만_만든다() {
        NoseApprovalRequest request = fiveEffectRequest();
        when(validator.validate(anyString(), anyString(), any(), anyMap(), anyMap(), anyMap()))
                .thenAnswer(inv -> inv.getArgument(5));

        String approval = service.validateForGeneration("mesh-key", "rig-key", request);

        assertThat(approval).contains("\"schemaVersion\":\"v2\"").contains("nose.alar_width");
        verify(storage).presignGet("mesh-key");
        verify(storage).presignGet("rig-key");
        // 기본값 1회 + 효과 5개 × 끝값 2개
        verify(validator, times(11))
                .validate(anyString(), anyString(), any(), anyMap(), anyMap(), anyMap());
        verifyNoInteractions(models);
    }

    @Test
    void 신규_생성_검증에서_검사기가_답하지_못하면_결과를_다시_보내라는_REC_023을_준다() {
        NoseApprovalRequest request = fiveEffectRequest();
        when(validator.validate(anyString(), anyString(), any(), anyMap(), anyMap(), anyMap()))
                .thenThrow(new NoseEditValidation.Unavailable());

        assertThatThrownBy(() -> service.validateForGeneration("mesh-key", "rig-key", request))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e ->
                                assertThat(e.errorCode())
                                        .isEqualTo(
                                                ReconstructionErrorCode.RESULT_CHECK_UNAVAILABLE));
        verifyNoInteractions(models);
    }

    @Test
    void 신규_생성_검증에서_형상_검사가_실패하면_지금처럼_EDIT_031이다() {
        NoseApprovalRequest request = fiveEffectRequest();
        when(validator.validate(anyString(), anyString(), any(), anyMap(), anyMap(), anyMap()))
                .thenThrow(new NoseEditValidation.InvalidResult());

        assertThatThrownBy(() -> service.validateForGeneration("mesh-key", "rig-key", request))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e ->
                                assertThat(e.errorCode())
                                        .isEqualTo(EditErrorCode.NOSE_EDIT_NOT_READY));
    }

    @Test
    void 기존_모델_승인에서_검사기가_답하지_못하면_지금처럼_EDIT_031이고_모델을_열지_않는다() {
        ready(null);
        when(parameters.ranges("v2")).thenReturn(catalog);
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        when(validator.validate(anyString(), anyString(), any(), anyMap(), anyMap(), anyMap()))
                .thenThrow(new NoseEditValidation.Unavailable());

        assertThatThrownBy(() -> service.approve("model", approvalRequest()))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e ->
                                assertThat(e.errorCode())
                                        .isEqualTo(EditErrorCode.NOSE_EDIT_NOT_READY));
        verify(model, never()).approveNose(anyString());
    }

    /** 신규 생성이 요구하는 코 다섯 효과 범위. 저장소·카탈로그 응답도 함께 준비한다. */
    private NoseApprovalRequest fiveEffectRequest() {
        Map<String, MorphRange> five = new HashMap<>();
        Map<String, NoseApprovalRequest.Range> ranges = new HashMap<>();
        for (String code :
                List.of(
                        "nose.bridge_height",
                        "nose.tip_projection",
                        "nose.tip_height",
                        "nose.tip_rotation",
                        "nose.alar_width")) {
            five.put(code, new MorphRange(code, code, -1, 1));
            ranges.put(code, new NoseApprovalRequest.Range(-0.4, 0.6));
        }
        when(parameters.ranges("v2")).thenReturn(five);
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        return new NoseApprovalRequest("v2", approvalRequest().binding(), ranges);
    }

    private NoseApprovalRequest approvalRequest() {
        return new NoseApprovalRequest(
                "v2",
                new NoseApprovalRequest.Binding(
                        "a".repeat(64), "b".repeat(64), "fit", "engine", "v1", "topology"),
                Map.of("nose.bridge_height", new NoseApprovalRequest.Range(-0.4, 0.6)));
    }

    @Test
    void 형상_검사_실패는_모델_준비_부족과_다른_오류다() {
        ready(
                "{\"schemaVersion\":\"v2\",\"binding\":{\"meshSha256\":\"mesh\",\"rigSha256\":\"rig\",\"fitSha\":\"fit\",\"engine\":\"engine\",\"rigVersion\":\"v1\",\"topologyVersion\":\"topology\"},\"ranges\":{\"nose.bridge_height\":{\"min\":-0.4,\"max\":0.6}}}");
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        when(validator.validate(
                        anyString(),
                        anyString(),
                        any(),
                        anyMap(),
                        anyMap(),
                        anyMap(),
                        any(),
                        any()))
                .thenThrow(new NoseEditValidation.UnsafeResult());

        assertThatThrownBy(() -> validate(false))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(EditErrorCode.UNSAFE_NOSE_EDIT));
    }

    @Test
    void 윤곽만_바꾸면_코_승인_없이도_검사기를_부르지_않고_윤곽값을_그대로_둔다() {
        Map<String, MorphRange> withContour =
                Map.of(
                        "nose.bridge_height",
                        new MorphRange("nose.bridge_height", "콧대", -1, 1),
                        "contour.jaw_angle",
                        new MorphRange("contour.jaw_angle", "사각턱", -1, 1));
        Map<String, Double> current = Map.of("nose.bridge_height", 0.2);
        MorphEdits.Applied candidate =
                MorphEdits.apply(
                        current,
                        List.of(new MorphEdits.Requested("contour.jaw_angle", -0.4)),
                        withContour);

        MorphEdits.Applied applied =
                service.validate(simulation, current, candidate, withContour, false);

        assertThat(applied.weights())
                .containsEntry("nose.bridge_height", 0.2)
                .containsEntry("contour.jaw_angle", -0.4);
        assertThat(applied.changes())
                .containsExactly(new MorphEdits.Change("contour.jaw_angle", 0.0, -0.4, false));
        verifyNoInteractions(storage, validator);
    }

    @Test
    void 코를_바꿀_때도_기존_윤곽값은_검사기_결과와_함께_남는다() {
        ready(
                "{\"schemaVersion\":\"v2\",\"binding\":{\"meshSha256\":\"mesh\",\"rigSha256\":\"rig\",\"fitSha\":\"fit\",\"engine\":\"engine\",\"rigVersion\":\"v1\",\"topologyVersion\":\"topology\"},\"ranges\":{\"nose.bridge_height\":{\"min\":-0.4,\"max\":0.6}}}");
        when(storage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://example.invalid/object", Map.of(), Instant.now()));
        when(validator.validate(
                        anyString(),
                        anyString(),
                        any(),
                        anyMap(),
                        anyMap(),
                        anyMap(),
                        any(),
                        any()))
                .thenReturn(
                        new NoseEditValidation.Checked(
                                Map.of("nose.bridge_height", 0.3), List.of()));
        Map<String, MorphRange> withContour =
                Map.of(
                        "nose.bridge_height",
                        new MorphRange("nose.bridge_height", "콧대", -1, 1),
                        "contour.cheekbone",
                        new MorphRange("contour.cheekbone", "광대 크기", -1, 1));
        Map<String, Double> current = Map.of("contour.cheekbone", 0.5);

        MorphEdits.Applied applied =
                service.validate(
                        simulation,
                        current,
                        MorphEdits.apply(
                                current,
                                List.of(new MorphEdits.Requested("nose.bridge_height", 0.3)),
                                withContour),
                        withContour,
                        false);

        assertThat(applied.weights())
                .containsEntry("nose.bridge_height", 0.3)
                .containsEntry("contour.cheekbone", 0.5);
        // 검사기에는 코 값만 보낸다
        verify(validator)
                .validate(
                        anyString(),
                        anyString(),
                        any(),
                        anyMap(),
                        eq(Map.of()),
                        eq(Map.of("nose.bridge_height", 0.3)),
                        any(),
                        any());
    }

    private void ready(String approval) {
        when(model.isChatApplyReady()).thenReturn(true);
        when(model.getMeshObjectKey()).thenReturn("model.glb");
        when(model.getRigObjectKey()).thenReturn("rig.json");
        when(model.getMorphSchemaVersion()).thenReturn("v2");
        when(model.getApprovedNoseCapabilities()).thenReturn(approval);
    }

    private MorphEdits.Applied validate(boolean chat) {
        return service.validate(
                simulation,
                Map.of(),
                MorphEdits.apply(
                        Map.of(),
                        List.of(new MorphEdits.Requested("nose.bridge_height", 0.5)),
                        catalog),
                catalog,
                chat);
    }
}
