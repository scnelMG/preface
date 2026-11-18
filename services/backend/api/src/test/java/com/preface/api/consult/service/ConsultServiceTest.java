package com.preface.api.consult.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.preface.api.consult.dto.EditAction;
import com.preface.api.consult.dto.SendMessageRequest;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse.Observation;
import com.preface.api.facemodel.service.BaselineMeasurementService;
import com.preface.api.simulation.dto.EyeCapabilities;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.api.simulation.service.EyeEditService;
import com.preface.api.simulation.service.MorphParameterService;
import com.preface.api.simulation.service.MorphStateCodec;
import com.preface.api.simulation.service.NoseEditService;
import com.preface.api.simulation.service.SimulationService;
import com.preface.api.simulation.service.WeightContourEditService;
import com.preface.api.simulation.service.WeightShapeModelApprovalService;
import com.preface.common.consult.entity.ChangeRequest;
import com.preface.common.consult.entity.ChangeRequestStatus;
import com.preface.common.consult.entity.ConsultMessage;
import com.preface.common.consult.entity.ConsultRole;
import com.preface.common.consult.repository.ChangeRequestRepository;
import com.preface.common.consult.repository.ConsultMessageRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ConsultErrorCode;
import com.preface.common.error.EditErrorCode;
import com.preface.common.error.ErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import tools.jackson.databind.json.JsonMapper;

class ConsultServiceTest {

    private final SpringConsultClient aiClient = mock(SpringConsultClient.class);
    private final BaselineMeasurementService baselineMeasurements =
            mock(BaselineMeasurementService.class);
    private final SimulationService simulationService = mock(SimulationService.class);
    private final SimulationRepository simulationRepository = mock(SimulationRepository.class);
    private final ConsultMessageRepository messageRepository = mock(ConsultMessageRepository.class);
    private final ChangeRequestRepository changeRequestRepository =
            mock(ChangeRequestRepository.class);
    private final MorphParameterService morphParameterService = mock(MorphParameterService.class);
    private final NoseEditService noseEditService = mock(NoseEditService.class);
    private final EyeEditService eyeEditService = mock(EyeEditService.class);
    private final FaceModelRepository faceModelRepository = mock(FaceModelRepository.class);
    private final WeightShapeModelApprovalService weightShapeApproval =
            mock(WeightShapeModelApprovalService.class);
    private ConsultService service;

    @BeforeEach
    void setUp() {
        JsonMapper jsonMapper = JsonMapper.builder().build();
        PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
        when(tx.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        service =
                new ConsultService(
                        aiClient,
                        simulationService,
                        simulationRepository,
                        messageRepository,
                        changeRequestRepository,
                        mock(com.preface.common.simulation.repository.MorphChangeRepository.class),
                        morphParameterService,
                        noseEditService,
                        eyeEditService,
                        faceModelRepository,
                        weightShapeApproval,
                        mock(WeightContourEditService.class),
                        baselineMeasurements,
                        new MorphStateCodec(jsonMapper),
                        new ConsultJson(jsonMapper),
                        Clock.systemUTC(),
                        tx);
        when(morphParameterService.ranges(anyString())).thenReturn(Map.of());
        when(messageRepository.findTop10BySimulationIdOrderBySeqDesc(anyString()))
                .thenReturn(List.of());
        when(changeRequestRepository.findFirstBySimulationIdAndStatusOrderByAppliedAtDesc(
                        anyString(), any()))
                .thenReturn(Optional.empty());
    }

    @Test
    void 원본_비율_상담은_소유자_검수값으로_답하고_AI나_편집을_호출하지_않는다() {
        var simulation =
                Simulation.create(
                        "user-1", "fm-1", "합성 시안", "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        when(messageRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(baselineMeasurements.read("user-1", "fm-1"))
                .thenReturn(
                        new BaselineMeasurementResponse(
                                BaselineMeasurementResponse.Status.AVAILABLE,
                                List.of(
                                        new Observation(
                                                "alarWidth",
                                                "콧볼",
                                                "audit-v1",
                                                "model-space",
                                                "reviewed-pair",
                                                34,
                                                36,
                                                ""),
                                        new Observation(
                                                "intercanthalDistance",
                                                "눈 간격",
                                                "audit-v1",
                                                "model-space",
                                                "reviewed-pair",
                                                29,
                                                30,
                                                ""))));
        var reply =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest("콧볼 너비와 눈 안쪽 간격을 비교해 주세요", null, null, null));
        assertThat(reply.assistantMessage().content()).contains("넓게 측정", "1.13~1.25배");
        verifyNoInteractions(aiClient, changeRequestRepository);
        assertThat(simulation.getStateVersion()).isZero();
    }

    @Test
    void 일반_비율_질문은_묻는_부위의_카드를_열고_특정_두_거리의_검수값을_조회하지_않는다() {
        var simulation =
                Simulation.create(
                        "user-1", "fm-1", "합성 시안", "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        when(messageRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        Map.of("제 얼굴 전체적으로 어때요?", "overall", "코 비율을 알려줘", "eyes", "입술 비율은 어떤가요?", "lips")
                .forEach(
                        (question, section) -> {
                            var reply =
                                    service.send(
                                            "user-1",
                                            "sim-1",
                                            new SendMessageRequest(question, null, null, null));
                            assertThat(reply.profileSection()).as(question).isEqualTo(section);
                            assertThat(reply.changeRequest()).isNull();
                        });
        verifyNoInteractions(baselineMeasurements, aiClient, changeRequestRepository);
        assertThat(simulation.getStateVersion()).isZero();
    }

    @Test
    void 추천과_부위별_분석은_편집_없이_저장되고_이전_대화에서_같은_종류로_조회된다() {
        var simulation =
                Simulation.create(
                        "user-1", "fm-1", "합성 시안", "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        String jawAngle = "contour.jaw_angle";
        String chinProjection = "contour.chin_projection";
        var model = mock(FaceModel.class);
        when(model.getId()).thenReturn("fm-1");
        when(faceModelRepository.findById("fm-1")).thenReturn(Optional.of(model));
        when(weightShapeApproval.supportedContourCodes(model))
                .thenReturn(java.util.Set.of(jawAngle, chinProjection));
        when(morphParameterService.ranges("v2"))
                .thenReturn(
                        Map.of(
                                jawAngle,
                                        new com.preface.api.simulation.service.MorphRange(
                                                jawAngle, "사각턱", -1, 1),
                                chinProjection,
                                        new com.preface.api.simulation.service.MorphRange(
                                                chinProjection, "턱끝 앞뒤", -1, 1)));
        when(aiClient.recommendNext(any(), any(), any(), any(), anyBoolean()))
                .thenAnswer(
                        invocation -> {
                            List<NextAdjustmentEvidence.Evidence> cards = invocation.getArgument(1);
                            assertThat(cards)
                                    .extracting(NextAdjustmentEvidence.Evidence::candidateId)
                                    .containsExactly("chinProjection", "jawAngle");
                            return List.of("jawAngle");
                        });
        List<ConsultMessage> messages = new ArrayList<>();
        when(messageRepository.maxSeq(any())).thenAnswer(invocation -> messages.size());
        when(messageRepository.save(any()))
                .thenAnswer(
                        invocation -> {
                            ConsultMessage message = invocation.getArgument(0);
                            messages.add(message);
                            return message;
                        });
        when(messageRepository.findBySimulationIdAndSeqLessThanEqual(eq("sim-1"), anyInt(), any()))
                .thenAnswer(invocation -> new PageImpl<>(messages));
        when(changeRequestRepository.findByConsultMessageIdIn(any())).thenReturn(List.of());

        var advice =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(
                                "다음 조절 추천받기",
                                "next-adjustment",
                                null,
                                null,
                                null,
                                null,
                                null,
                                null,
                                "next:chinProjection,jawAngle,chinLength,projection:fold"));
        var profile =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(
                                "입술은요?", "face-ratio", null, null, null, null, null, null, "lips"));

        var analysis =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(
                                "인중과 턱을 분석해 주세요.",
                                "face-ratio",
                                null,
                                null,
                                null,
                                null,
                                null,
                                null,
                                "analysis:lower:chinProjection,jawAngle,projection"));
        when(eyeEditService.support("fm-1"))
                .thenReturn(
                        new EyeEditService.Support(
                                new EyeReview("absent", "absent"),
                                new EyeCapabilities(
                                        "v1",
                                        "a",
                                        "b",
                                        "c",
                                        "engine",
                                        "rig",
                                        "topology",
                                        Map.of("inner", 20.0)),
                                "c"));
        var eyeAnalysis =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(
                                "눈 비율을 분석해 주세요.",
                                "face-ratio",
                                null,
                                null,
                                null,
                                null,
                                null,
                                null,
                                "analysis:eyes:eyeInner,jawAngle"));

        assertThat(analysis.profileSection()).isEqualTo("analysis:lower:jawAngle");
        assertThat(eyeAnalysis.profileSection()).isEqualTo("analysis:eyes:eyeInner");
        assertThat(eyeAnalysis.changeRequest()).isNull();
        assertThat(analysis.changeRequest()).isNull();
        assertThat(advice.changeRequest()).isNull();
        assertThat(profile.changeRequest()).isNull();
        assertThat(service.messages("user-1", "sim-1", 0, 20, true).items())
                .extracting(item -> item.profileSection())
                .containsExactly(
                        null,
                        "next:jawAngle:fold",
                        null,
                        "lips",
                        null,
                        "analysis:lower:jawAngle",
                        null,
                        "analysis:eyes:eyeInner");
        verify(aiClient).recommendNext(any(), any(), any(), any(), eq(false));
        when(aiClient.recommendMeasuredNext(any(), any(), any()))
                .thenAnswer(
                        invocation -> {
                            List<NextAdjustmentEvidence.Trial> trials = invocation.getArgument(1);
                            assertThat(trials).hasSize(1);
                            var trial = trials.getFirst();
                            assertThat(trial.before()).isEqualTo(0.8);
                            assertThat(trial.after()).isEqualTo(0.76);
                            var result =
                                    new NextAdjustmentEvidence.MeasuredResult(
                                            List.of(
                                                    new NextAdjustmentEvidence.MeasuredSelection(
                                                            "jawAngle",
                                                            trial.evidence().metricId(),
                                                            trial.evidence().evidenceId(),
                                                            "up",
                                                            "확인하지 않은 조절이에요."),
                                                    new NextAdjustmentEvidence.MeasuredSelection(
                                                            "jawAngle",
                                                            trial.evidence().metricId(),
                                                            trial.evidence().evidenceId(),
                                                            "down",
                                                            "정면에서 아래턱 폭은 얼굴 너비의 대부분을 차지해요. 사각턱 폭을 살짝 좁혀 보면 턱선 양옆이 안쪽으로 모여 보여요.")));
                            return NextAdjustmentEvidence.validateMeasured(result, trials);
                        });
        var measured =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(
                                "다음 조절 알려 주세요",
                                "next-adjustment",
                                null,
                                null,
                                null,
                                null,
                                null,
                                null,
                                "next:jawAngle,chinProjection",
                                null,
                                Map.of(
                                        "trial-version",
                                        1.0,
                                        "trial-state",
                                        0.0,
                                        "jaw-width-face-width",
                                        0.8,
                                        "jawAngle:down",
                                        0.76,
                                        "jawAngle:up",
                                        0.8)));
        assertThat(measured.profileSection())
                .isEqualTo("next:jawAngle:measured:-1/0.8/0.76:narrative");
        verify(aiClient).recommendMeasuredNext(any(), any(), eq("0"));
        assertThat(measured.changeRequest()).isNull();
        assertThat(service.messages("user-1", "sim-1", 0, 20, true).items())
                .anySatisfy(
                        item -> {
                            assertThat(item.profileSection()).isEqualTo(measured.profileSection());
                            assertThat(item.content())
                                    .isEqualTo(
                                            "정면에서 아래턱 폭은 얼굴 너비의 대부분을 차지해요. 사각턱 폭을 살짝 좁혀 보면 턱선 양옆이 안쪽으로 모여 보여요.");
                        });
        verifyNoInteractions(baselineMeasurements);
        assertThat(simulation.getStateVersion()).isZero();
    }

    @Test
    void 빈_메시지와_300자를_넘는_메시지는_AI를_부르지_않고_CON_001이다() {
        assertCode(() -> send("   "), ConsultErrorCode.INVALID_MESSAGE);
        assertCode(() -> send("가".repeat(301)), ConsultErrorCode.INVALID_MESSAGE);
        verifyNoInteractions(aiClient);
    }

    @Test
    void 고민에서_고른_부위는_비교에서만_후속_조절로_이어진다() {
        Simulation simulation =
                Simulation.create(
                        "user-1", "fm-1", "합성 시안", "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        String code = "contour.cheekbone";
        var model = mock(FaceModel.class);
        when(model.getId()).thenReturn("fm-1");
        when(faceModelRepository.findById("fm-1")).thenReturn(Optional.of(model));
        when(weightShapeApproval.supportedContourCodes(model)).thenReturn(java.util.Set.of(code));
        when(morphParameterService.ranges("v2"))
                .thenReturn(
                        Map.of(
                                code,
                                new com.preface.api.simulation.service.MorphRange(
                                        code, "광대", -1, 1)));
        var messages = new ArrayList<ConsultMessage>();
        when(messageRepository.save(any()))
                .thenAnswer(
                        invocation -> {
                            ConsultMessage saved = invocation.getArgument(0);
                            org.springframework.test.util.ReflectionTestUtils.setField(
                                    saved, "id", "message-" + messages.size());
                            messages.addFirst(saved);
                            return saved;
                        });
        when(messageRepository.findTop10BySimulationIdOrderBySeqDesc(anyString()))
                .thenAnswer(invocation -> List.copyOf(messages));
        when(messageRepository.findFirstBySimulationIdOrderBySeqDesc(anyString()))
                .thenAnswer(invocation -> messages.stream().findFirst());
        when(messageRepository.maxSeq(any())).thenAnswer(invocation -> messages.size());
        String concern = "정면에서 콧볼 너비를 비교하고 싶어요. 코끝은 그대로 두고 싶어요.";
        when(aiClient.advise(any()))
                .thenReturn(
                        new AiConsult.Response(
                                concern,
                                false,
                                "정면에서 광대를 살펴볼 수 있어요.",
                                "REPLY",
                                null,
                                false,
                                List.of(),
                                false,
                                code));

        var advice =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(concern, "consult-advice", null, null));
        assertThat(advice.recommendedSliderCode()).isEqualTo(code);
        assertThat(advice.changeRequest()).isNull();
        verifyNoInteractions(baselineMeasurements);
        assertThat(messages.getFirst().getRole()).isEqualTo(ConsultRole.ASSISTANT);
        when(messageRepository.findBySimulationId(anyString(), any()))
                .thenReturn(new org.springframework.data.domain.PageImpl<>(List.copyOf(messages)));
        assertThat(service.messages("user-1", "sim-1", 0, 10, false).items())
                .extracting(item -> item.comparisonCode())
                .containsExactly(code, null);
        var plain =
                service.send(
                        "user-1", "sim-1", new SendMessageRequest("그럼 조금 줄여줘", null, null, null));
        assertThat(plain.changeRequest()).isNull();
        verify(changeRequestRepository, never()).save(any());

        service.send(
                "user-1", "sim-1", new SendMessageRequest(concern, "consult-advice", null, null));
        var preview =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest("그럼 거기만 조금 줄여줘", "consult-preview", null, null));
        assertThat(preview.changeRequest().actions())
                .singleElement()
                .satisfies(
                        action -> {
                            assertThat(action.code()).isEqualTo(code);
                            assertThat(action.direction()).isEqualTo(-1);
                        });
        assertThat(simulation.getStateVersion()).isZero();
        verify(aiClient, never()).consult(any());

        String explicit = "사각턱은 그대로 두고 광대만 살짝 키워보면 어떨까요?";
        when(aiClient.consultPreview(any()))
                .thenReturn(
                        new AiConsult.Response(
                                explicit,
                                false,
                                "",
                                "EDIT",
                                new AiConsult.CandidateRequest(
                                        "COMPLETE",
                                        "v2",
                                        List.of(new EditAction(code, "both", 1, "small")),
                                        List.of()),
                                false,
                                List.of(),
                                false,
                                null));
        var explicitPreview =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(explicit, "consult-preview", null, null));
        assertThat(explicitPreview.changeRequest().actions())
                .containsExactly(new EditAction(code, "both", 1, "small"));
        assertThat(simulation.getStateVersion()).isZero();

        service.send(
                "user-1", "sim-1", new SendMessageRequest(concern, "consult-advice", null, null));
        String natural = "그 부분만 조금 줄여서 보고 싶어요";
        when(aiClient.consultComparison(any(), eq(code)))
                .thenReturn(
                        new AiConsult.Response(
                                natural,
                                false,
                                "",
                                "EDIT",
                                new AiConsult.CandidateRequest(
                                        "COMPLETE",
                                        "v2",
                                        List.of(new EditAction(code, "both", -1, "small")),
                                        List.of()),
                                false,
                                List.of(),
                                false,
                                null));
        var naturalPreview =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(natural, "consult-preview", null, null));
        assertThat(naturalPreview.changeRequest().actions())
                .containsExactly(new EditAction(code, "both", -1, "small"));
        assertThat(simulation.getStateVersion()).isZero();
    }

    @Test
    void 단일_부위_되묻기에_방향으로_답하면_그_부위만_이어가고_시안이_바뀌면_거절한다() {
        var simulation =
                Simulation.create(
                        "user-1", "fm-1", "합성 시안", "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        when(messageRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        String code = "contour.jaw_angle";
        var model = mock(FaceModel.class);
        when(model.getId()).thenReturn("fm-1");
        when(faceModelRepository.findById("fm-1")).thenReturn(Optional.of(model));
        when(weightShapeApproval.supportedContourCodes(model)).thenReturn(java.util.Set.of(code));
        when(morphParameterService.ranges("v2"))
                .thenReturn(
                        Map.of(
                                code,
                                new com.preface.api.simulation.service.MorphRange(
                                        code, "사각턱", -1, 1)));
        var json = new ConsultJson(JsonMapper.builder().build());
        var previous =
                ConsultMessage.assistant(
                        "sim-1",
                        2,
                        "사각턱을 어느 방향으로 바꿀까요?",
                        "CLARIFY",
                        true,
                        json.write(
                                List.of(
                                        new ConsultJson.StoredOption(
                                                "option-1", "사각턱", List.of(), 0, null, code))),
                        false);
        org.springframework.test.util.ReflectionTestUtils.setField(previous, "id", "message-2");
        when(messageRepository.findTop10BySimulationIdOrderBySeqDesc("sim-1"))
                .thenReturn(List.of(previous));
        when(messageRepository.findFirstBySimulationIdOrderBySeqDesc("sim-1"))
                .thenReturn(Optional.of(previous));
        String direction = "그럼 조금 줄여줘";
        var request = new SendMessageRequest(direction, null, null, null);

        var reply = service.send("user-1", "sim-1", request);
        assertThat(reply.changeRequest().actions())
                .containsExactly(new EditAction(code, "both", -1, "small", direction));
        assertThat(simulation.getStateVersion()).isZero();

        simulation.invalidateEditorVersion();
        var stale = service.send("user-1", "sim-1", request);
        assertThat(stale.changeRequest()).isNull();
        assertThat(stale.assistantMessage().content()).contains("시안이나 대화가 바뀌었어요");
        verifyNoInteractions(aiClient);
        verify(changeRequestRepository).save(any());
    }

    @Test
    void 턱_비교_버튼은_지원된_턱만_보여주고_선택을_미리보기로_연결한다() {
        var simulation =
                Simulation.create(
                        "user-1", "fm-1", "합성 시안", "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        String jaw = "contour.jaw_angle";
        String cheek = "contour.cheekbone";
        var model = mock(FaceModel.class);
        when(model.getId()).thenReturn("fm-1");
        when(faceModelRepository.findById("fm-1")).thenReturn(Optional.of(model));
        when(weightShapeApproval.supportedContourCodes(model))
                .thenReturn(java.util.Set.of(jaw, cheek));
        when(morphParameterService.ranges("v2"))
                .thenReturn(
                        Map.of(
                                jaw,
                                        new com.preface.api.simulation.service.MorphRange(
                                                jaw, "사각턱", -1, 1),
                                cheek,
                                        new com.preface.api.simulation.service.MorphRange(
                                                cheek, "광대", -1, 1)));
        var messages = new ArrayList<ConsultMessage>();
        when(messageRepository.save(any()))
                .thenAnswer(
                        invocation -> {
                            ConsultMessage saved = invocation.getArgument(0);
                            org.springframework.test.util.ReflectionTestUtils.setField(
                                    saved, "id", "message-" + messages.size());
                            messages.addFirst(saved);
                            return saved;
                        });
        when(messageRepository.findTop10BySimulationIdOrderBySeqDesc(anyString()))
                .thenAnswer(invocation -> List.copyOf(messages));
        when(messageRepository.findFirstBySimulationIdOrderBySeqDesc(anyString()))
                .thenAnswer(invocation -> messages.stream().findFirst());
        when(messageRepository.maxSeq(any())).thenAnswer(invocation -> messages.size());
        var button =
                new SendMessageRequest(
                        "인중·턱에서 비교할 조절 찾기",
                        "profile-comparison",
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        "lower");

        var result = service.send("user-1", "sim-1", button);
        assertThat(result.options())
                .singleElement()
                .satisfies(
                        option -> {
                            assertThat(option.label()).isEqualTo("사각턱");
                            var selection =
                                    service.send(
                                            "user-1",
                                            "sim-1",
                                            new SendMessageRequest("사각턱", null, option.id(), null));
                            assertThat(selection.recommendedSliderCode()).isEqualTo(jaw);
                            assertThat(selection.changeRequest()).isNull();
                        });
        verifyNoInteractions(aiClient, baselineMeasurements);
        verify(changeRequestRepository, never()).save(any());
        assertThat(simulation.getStateVersion()).isZero();

        var stale = service.send("user-1", "sim-1", button).options().getFirst();
        simulation.invalidateEditorVersion();
        var rejected =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(stale.label(), null, stale.id(), null));
        assertThat(rejected.recommendedSliderCode()).isNull();
        assertThat(rejected.changeRequest()).isNull();

        simulation.moveTo(
                "{\"schemaVersion\":\"v2\",\"weights\":{\"contour.weight_shape\":0.2}}", 0);
        var locked = service.send("user-1", "sim-1", button);
        assertThat(locked.options()).isEmpty();
        assertThat(locked.changeRequest()).isNull();
        verify(changeRequestRepository, never()).save(any());
    }

    @Test
    void 고민_상담은_편집_명령이_들어와도_대화만_기록한다() {
        var simulation =
                Simulation.create(
                        "user-1", "fm-1", "합성 시안", "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        String command = "처음으로";
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        when(messageRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(aiClient.advise(any()))
                .thenReturn(
                        new AiConsult.Response(
                                command,
                                false,
                                "원본과 비교할 부위를 말씀해 주세요.",
                                "REPLY",
                                null,
                                false,
                                List.of(),
                                false,
                                null));

        service.send(
                "user-1", "sim-1", new SendMessageRequest(command, "consult-advice", null, null));

        verify(aiClient).advise(any());
        verify(aiClient, never()).consult(any());
        verify(changeRequestRepository, never()).save(any());
        assertThat(simulation.getStateVersion()).isZero();
    }

    @Test
    void AI가_실패하면_사용자_메시지도_변경_요청도_저장하지_않는다() {
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(
                        Optional.of(
                                Simulation.create(
                                        "user-1",
                                        "fm-1",
                                        "2026.10.25 시안",
                                        "{\"schemaVersion\":\"v2\",\"weights\":{}}")));
        when(aiClient.consult(any()))
                .thenThrow(new BusinessException(ConsultErrorCode.AI_TIMEOUT, "test"));

        assertCode(() -> send("콧대를 조금 높여줘"), ConsultErrorCode.AI_TIMEOUT);

        verify(messageRepository, never()).save(any());
        verify(changeRequestRepository, never()).save(any());
        verify(simulationService, never()).lockOwned(anyString(), anyString());
    }

    @Test
    void 남의_시안이면_AI를_부르지_않고_COMMON_002다() {
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull(anyString(), anyString()))
                .thenReturn(Optional.empty());

        assertCode(() -> send("콧대를 조금 높여줘"), CommonErrorCode.NOT_FOUND);
        verifyNoInteractions(aiClient);
    }

    @Test
    void 윤곽_코드는_검증된_GLB로_체중_코드는_별도_승인으로_채팅에_포함한다() {
        Simulation simulation =
                Simulation.create(
                        "user-1", "fm-1", "합성 시안", "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(morphParameterService.ranges("v2"))
                .thenReturn(
                        Map.of(
                                "nose.bridge_height",
                                        new com.preface.api.simulation.service.MorphRange(
                                                "nose.bridge_height", "콧대 높이", -1, 1),
                                "contour.cheekbone",
                                        new com.preface.api.simulation.service.MorphRange(
                                                "contour.cheekbone", "광대", -1, 1),
                                "contour.weight_shape",
                                        new com.preface.api.simulation.service.MorphRange(
                                                "contour.weight_shape", "체중 변화", -1, 1)));
        var approved = new java.util.concurrent.atomic.AtomicBoolean(true);
        when(simulationService.weightShapeSupported("fm-1"))
                .thenAnswer(invocation -> approved.get());
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn("fm-1");
        when(model.getMeshObjectKey()).thenReturn("synthetic.glb");
        when(model.getApprovedWeightShape()).thenReturn("{\"synthetic\":true}");
        when(faceModelRepository.findById("fm-1")).thenReturn(Optional.of(model));
        when(weightShapeApproval.supportedContourCodes(model))
                .thenReturn(java.util.Set.of("contour.cheekbone"));
        doAnswer(
                        invocation -> {
                            AiConsult.Request request = invocation.getArgument(0);
                            if (approved.get()) {
                                assertThat(request.allowedCodes())
                                        .contains("contour.cheekbone", "contour.weight_shape")
                                        .doesNotContain("nose.bridge_height");
                                assertThat(request.allowedParts()).contains("CONTOUR");
                                assertThat(request.morphState().weightContourCombineAllowed())
                                        .isFalse();
                            } else {
                                assertThat(request.allowedCodes())
                                        .contains("contour.cheekbone")
                                        .doesNotContain("contour.weight_shape");
                                assertThat(request.allowedParts()).contains("CONTOUR");
                                assertThat(request.morphState().weightContourCombineAllowed())
                                        .isFalse();
                            }
                            throw new BusinessException(ConsultErrorCode.AI_UNAVAILABLE);
                        })
                .when(aiClient)
                .consult(any());
        assertCode(() -> send("광대를 키워줘"), ConsultErrorCode.AI_UNAVAILABLE);
        when(weightShapeApproval.supportedContourCodes(model)).thenReturn(java.util.Set.of());
        doAnswer(
                        invocation -> {
                            AiConsult.Request request = invocation.getArgument(0);
                            assertThat(request.morphState().weightContourCombineAllowed())
                                    .isFalse();
                            if (approved.get()) {
                                assertThat(request.allowedCodes())
                                        .contains("contour.weight_shape")
                                        .doesNotContain("contour.cheekbone");
                            } else {
                                assertThat(request.allowedCodes())
                                        .contains("contour.cheekbone")
                                        .doesNotContain("contour.weight_shape");
                            }
                            throw new BusinessException(ConsultErrorCode.AI_UNAVAILABLE);
                        })
                .when(aiClient)
                .consult(any());
        assertCode(() -> send("광대를 키워줘"), ConsultErrorCode.AI_UNAVAILABLE);
        approved.set(false);
        when(weightShapeApproval.supportedContourCodes(model))
                .thenReturn(java.util.Set.of("contour.cheekbone"));
        assertCode(() -> send("광대를 키워줘"), ConsultErrorCode.AI_UNAVAILABLE);
    }

    @Test
    void 채팅_적용이_열리지_않은_3D면_EDIT_030이고_얼굴과_변경_요청을_바꾸지_않는다() {
        Simulation simulation =
                Simulation.create(
                        "user-1",
                        "fm-1",
                        "2026.10.25 시안",
                        "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        ChangeRequest request =
                ChangeRequest.complete(
                        "req-1",
                        "sim-1",
                        "msg-1",
                        "NOSE",
                        "{\"requestId\":\"req-1\",\"schemaVersion\":\"v2\",\"actions\":[{\"code\":\"nose.bridge_height\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\"}]}",
                        "v2");
        when(changeRequestRepository.findByIdAndSimulationId("req-1", "sim-1"))
                .thenReturn(Optional.of(request));
        when(faceModelRepository.findById("fm-1"))
                .thenReturn(
                        Optional.of(
                                FaceModel.create(
                                        "user-1", "job-1", "k", null, null, null, null, "GLB", "v1",
                                        null)));

        assertCode(
                () -> service.apply("user-1", "sim-1", "req-1", 0),
                EditErrorCode.CHAT_APPLY_NOT_SUPPORTED);
        assertCode(
                () -> service.preview("user-1", "sim-1", "req-1", 0),
                EditErrorCode.CHAT_APPLY_NOT_SUPPORTED);

        verify(simulationService, never()).recordChat(any(), any(), anyString(), anyString());
        assertThat(request.getStatus()).isEqualTo(ChangeRequestStatus.COMPLETE);
    }

    @Test
    void 직접_조절에서_고른_항목보다_문장에_명시한_부위를_우선한다() {
        var simulation =
                Simulation.create(
                        "user-1", "fm-1", "합성 시안", "{\"schemaVersion\":\"v2\",\"weights\":{}}");
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        when(messageRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        String content = "코끝을 살짝 올려줘";
        var tip = new EditAction("nose.tip_height", "both", 1, "small");
        when(aiClient.consult(any()))
                .thenAnswer(
                        invocation -> {
                            AiConsult.Request request = invocation.getArgument(0);
                            assertThat(request.message().content()).isEqualTo(content);
                            return new AiConsult.Response(
                                    content,
                                    false,
                                    "",
                                    "EDIT",
                                    new AiConsult.CandidateRequest(
                                            "COMPLETE", "v2", List.of(tip), List.of()),
                                    false,
                                    List.of(),
                                    false,
                                    null);
                        });

        var response =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(
                                content,
                                null,
                                null,
                                null,
                                null,
                                null,
                                new SendMessageRequest.DirectControl("contour.chin_length", 0)));

        assertThat(response.changeRequest().actions()).containsExactly(tip);
    }

    @Test
    void 직접_조절에서_고른_항목만_후보가_되고_시안_버전이_바뀌면_편집하지_않는다() {
        String original = "{\"schemaVersion\":\"v2\",\"weights\":{}}";
        Simulation simulation = Simulation.create("user-1", "fm-1", "합성 시안", original);
        when(simulationRepository.findByIdAndUserIdAndDeletedAtIsNull("sim-1", "user-1"))
                .thenReturn(Optional.of(simulation));
        when(simulationService.lockOwned("user-1", "sim-1")).thenReturn(simulation);
        when(messageRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(simulationService.weightShapeSupported("fm-1")).thenReturn(true);
        when(morphParameterService.ranges("v2"))
                .thenReturn(
                        Map.of(
                                "contour.weight_shape",
                                new com.preface.api.simulation.service.MorphRange(
                                        "contour.weight_shape", "체중 변화", -1, 1)));
        var selection = new SendMessageRequest.DirectControl("contour.weight_shape", 0);

        var candidate =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(
                                "여기만 조금 감량해줘", null, null, null, null, null, selection));
        assertThat(candidate.changeRequest().actions())
                .singleElement()
                .satisfies(
                        action -> {
                            assertThat(action.code()).isEqualTo("contour.weight_shape");
                            assertThat(action.direction()).isEqualTo(-1);
                        });
        assertThat(simulation.getStateVersion()).isZero();

        simulation.moveTo(original, 1);
        var stale =
                service.send(
                        "user-1",
                        "sim-1",
                        new SendMessageRequest(
                                "여기만 조금 감량해줘", null, null, null, null, null, selection));
        assertThat(stale.changeRequest()).isNull();
        assertThat(stale.assistantMessage().content()).contains("시안이 바뀌었어요");
        assertThat(simulation.getStateVersion()).isEqualTo(1);
        assertThat(simulation.getCurrentSeq()).isEqualTo(1);
        verify(changeRequestRepository).save(any());
        verifyNoInteractions(aiClient);
    }

    private void send(String content) {
        service.send("user-1", "sim-1", new SendMessageRequest(content, null, null, null));
    }

    private static void assertCode(Runnable call, ErrorCode expected) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(expected));
    }
}
