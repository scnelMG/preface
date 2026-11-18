package com.preface.api.consult.service;

import com.preface.api.consult.dto.AppliedChange;
import com.preface.api.consult.dto.ApplyChangeRequestResponse;
import com.preface.api.consult.dto.ApplyResult;
import com.preface.api.consult.dto.ChangeRequestView;
import com.preface.api.consult.dto.ConsultMessageListResponse;
import com.preface.api.consult.dto.EditAction;
import com.preface.api.consult.dto.SendMessageRequest;
import com.preface.api.consult.dto.SendMessageRequest.ModeSwitch;
import com.preface.api.consult.dto.SendMessageResponse;
import com.preface.api.consult.dto.SkippedClause;
import com.preface.api.consult.service.ConsultJson.StoredOption;
import com.preface.api.consult.service.ConsultJson.StoredRequest;
import com.preface.api.facemodel.service.BaselineMeasurementService;
import com.preface.api.simulation.dto.EditResultResponse;
import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.MorphState;
import com.preface.api.simulation.service.EyeEditService;
import com.preface.api.simulation.service.MorphEdits;
import com.preface.api.simulation.service.MorphParameterService;
import com.preface.api.simulation.service.MorphRange;
import com.preface.api.simulation.service.MorphStateCodec;
import com.preface.api.simulation.service.NoseEditService;
import com.preface.api.simulation.service.SimulationService;
import com.preface.api.simulation.service.WeightContourEditService;
import com.preface.api.simulation.service.WeightShapeEditGuard;
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
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.MorphChangeSource;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.MorphChangeRepository;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 상담 메시지(API-CON-01·02)와 변경 요청 반영(API-EDIT-05). 계약: {@code contracts/edit/consult-apply-v1.md}.
 *
 * <p>CON-01 흐름: ① 읽기 트랜잭션에서 소유권 확인·AI 문맥 수집 → ② <b>트랜잭션 밖에서</b> Spring의 GMS 상담 호출(최대 수십 초라 시안 행 잠금을
 * 잡지 않는다) → ③ 시안을 잠그고 사용자·도우미 메시지를 seq n+1·n+2로, 편집 후보가 있으면 변경 요청을 한 트랜잭션에 저장한다. AI가 실패하면 ③을 하지
 * 않으므로 아무것도 저장되지 않는다.
 *
 * <p>상담은 후보만 만든다. 얼굴은 FE가 이어서 부르는 EDIT-05가 슬라이더와 같은 이력·{@code stateVersion} 규칙으로 바꾼다.
 */
@Service
public class ConsultService {

    static final String SENDER = "AI 실장님";
    static final int MAX_CONTENT = 300;
    private static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_RECENT_CONTENT = 500;
    private static final String SCHEMA_V2 = "v2";
    private static final String WEIGHT_CODE = "contour.weight_shape";

    private final SpringConsultClient aiClient;
    private final SimulationService simulationService;
    private final SimulationRepository simulationRepository;
    private final ConsultMessageRepository messageRepository;
    private final ChangeRequestRepository changeRequestRepository;
    private final MorphChangeRepository morphChangeRepository;
    private final MorphParameterService morphParameterService;
    private final NoseEditService noseEditService;
    private final EyeEditService eyeEditService;
    private final FaceModelRepository faceModelRepository;
    private final WeightShapeModelApprovalService weightShapeApproval;
    private final WeightContourEditService weightContourEditService;
    private final BaselineMeasurementService baselineMeasurements;
    private final MorphStateCodec codec;
    private final ConsultJson json;
    private final Clock clock;
    private final TransactionTemplate writeTx;
    private final TransactionTemplate readTx;

    public ConsultService(
            SpringConsultClient aiClient,
            SimulationService simulationService,
            SimulationRepository simulationRepository,
            ConsultMessageRepository messageRepository,
            ChangeRequestRepository changeRequestRepository,
            MorphChangeRepository morphChangeRepository,
            MorphParameterService morphParameterService,
            NoseEditService noseEditService,
            EyeEditService eyeEditService,
            FaceModelRepository faceModelRepository,
            WeightShapeModelApprovalService weightShapeApproval,
            WeightContourEditService weightContourEditService,
            BaselineMeasurementService baselineMeasurements,
            MorphStateCodec codec,
            ConsultJson json,
            Clock clock,
            PlatformTransactionManager transactionManager) {
        this.aiClient = aiClient;
        this.simulationService = simulationService;
        this.simulationRepository = simulationRepository;
        this.messageRepository = messageRepository;
        this.changeRequestRepository = changeRequestRepository;
        this.morphChangeRepository = morphChangeRepository;
        this.morphParameterService = morphParameterService;
        this.noseEditService = noseEditService;
        this.eyeEditService = eyeEditService;
        this.faceModelRepository = faceModelRepository;
        this.weightShapeApproval = weightShapeApproval;
        this.weightContourEditService = weightContourEditService;
        this.baselineMeasurements = baselineMeasurements;
        this.codec = codec;
        this.json = json;
        this.clock = clock;
        this.writeTx = new TransactionTemplate(transactionManager);
        this.readTx = new TransactionTemplate(transactionManager);
        this.readTx.setReadOnly(true);
    }

    /** API-CON-01. */
    public SendMessageResponse send(
            String userId, String simulationId, SendMessageRequest request) {
        String content = request.content() == null ? "" : request.content().strip();
        if (content.isEmpty() || content.length() > MAX_CONTENT) {
            throw new BusinessException(ConsultErrorCode.INVALID_MESSAGE);
        }
        if (request.requestId() != null) {
            try {
                if (!UUID.fromString(request.requestId()).toString().equals(request.requestId())) {
                    throw new IllegalArgumentException("non-canonical requestId");
                }
            } catch (IllegalArgumentException e) {
                throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
            }
        }
        var owned = ownedReadable(userId, simulationId);
        int conversation = owned.getConsultAfterSeq();
        if (request.conversationAfterSeq() != null) {
            requireConversation(conversation, request.conversationAfterSeq());
        }
        String optionId = request.selectedOptionId();
        ModeSwitch modeSwitch = request.modeSwitch();
        var directControl = request.directControl();
        boolean preview = "consult-preview".equals(request.exampleId());
        var comparisonTarget = request.comparisonTarget();
        if (comparisonTarget != null
                && (!preview
                        || comparisonTarget.code() == null
                        || comparisonTarget.value() == null
                        || !Double.isFinite(comparisonTarget.value())
                        || Math.abs(comparisonTarget.value()) > 1)) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        boolean profileComparison = "profile-comparison".equals(request.exampleId());
        if (profileComparison
                && (modeSwitch != null
                        || optionId != null
                        || directControl != null
                        || !("eyes".equals(request.profileSection())
                                || "lower".equals(request.profileSection())))) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        if (preview
                && (modeSwitch != null
                        || optionId != null
                        || directControl != null
                        || ConsultCommand.parse(content).isPresent()
                        || ConsultCorrection.parse(content).isPresent())) {
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
        }
        boolean nextAdjustment = "next-adjustment".equals(request.exampleId());
        boolean explicitProfile =
                "face-ratio".equals(request.exampleId()) && request.profileSection() != null;
        if ((nextAdjustment || explicitProfile)
                && (modeSwitch != null
                        || optionId != null
                        || directControl != null
                        || !validProfileSection(request.profileSection())
                        || nextAdjustment != request.profileSection().startsWith("next:"))) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        if (!profileComparison
                && comparisonTarget == null
                && modeSwitch == null
                && optionId == null
                && directControl == null
                && !("consult-advice".equals(request.exampleId()) && content.startsWith("상담 목표: "))
                && (!"consult-advice".equals(request.exampleId())
                        || FaceRatioConsultation.hasFixedEvidenceQuestion(content))
                && (explicitProfile
                        || nextAdjustment
                        || FaceRatioConsultation.isQuestion(content))) {
            String masked = SpringConsultClient.maskNames(content);
            boolean reference =
                    SpringConsultClient.isReferenceRequest(content, masked)
                            && !SpringConsultClient.isOwnPhotoQuestion(content, masked);
            if (!reference
                    && (nextAdjustment
                            || (explicitProfile
                                    && request.profileSection().startsWith("analysis:")))) {
                return recommendNext(
                        userId,
                        simulationId,
                        request,
                        masked,
                        !masked.equals(content),
                        conversation);
            }
            String section =
                    reference
                            ? null
                            : explicitProfile
                                    ? request.profileSection()
                                    : FaceRatioConsultation.profileSection(content);
            var measurements =
                    !reference
                                    && !explicitProfile
                                    && FaceRatioConsultation.needsMeasurements(content)
                            ? baselineMeasurements.read(userId, owned.getFaceModelId())
                            : null;
            String answer =
                    reference
                            ? "다른 분의 얼굴이나 사진과는 비교할 수 없어요. 본인 시안의 검수된 비율은 ‘내 얼굴 비율 분석’에서 확인할 수 있어요."
                            : section != null
                                    ? "현재 시안에서 확인할 수 있는 비율과 측정 기준이에요."
                                    : FaceRatioConsultation.answer(content, measurements);
            return writeTx.execute(
                    s -> {
                        Simulation simulation = simulationService.lockOwned(userId, simulationId);
                        requireConversation(simulation.getConsultAfterSeq(), conversation);
                        return saveTurn(
                                simulation,
                                reference ? "[인물·사진 참조 요청]" : masked,
                                !masked.equals(content) || reference,
                                answer,
                                "REPLY",
                                false,
                                section == null
                                        ? List.of()
                                        : List.of(
                                                new StoredOption(
                                                        "profile:" + section,
                                                        "",
                                                        List.of(),
                                                        simulation.getStateVersion(),
                                                        null,
                                                        null)),
                                reference,
                                List.of(),
                                List.of(),
                                null,
                                null);
                    });
        }
        if (("consult-advice".equals(request.exampleId()) || profileComparison)
                && optionId == null) {
            if (modeSwitch != null || directControl != null) {
                throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
            }
            ContourSupport contour = contourSupport(userId, simulationId);
            ConsultationInput input =
                    readTx.execute(
                            s ->
                                    buildAiRequest(
                                            userId,
                                            simulationId,
                                            content,
                                            request.requestId(),
                                            contour,
                                            null));
            requireConversation(input.conversation(), conversation);
            var aiRequest = input.request();
            String section = request.profileSection();
            if (section != null && SpringConsultClient.PROFILE_SECTIONS.contains(section)) {
                aiRequest =
                        new AiConsult.Request(
                                aiRequest.simulationId(),
                                aiRequest.requestId(),
                                new AiConsult.Message(content, null, section),
                                aiRequest.currentRequest(),
                                aiRequest.recentMessages(),
                                aiRequest.measurements(),
                                aiRequest.morphState(),
                                aiRequest.allowedParts(),
                                aiRequest.allowedCodes());
            }
            AiConsult.Response advice =
                    profileComparison
                            ? profileComparisonAdvice(aiRequest, section)
                            : aiClient.advise(aiRequest);
            return writeTx.execute(
                    s -> {
                        Simulation simulation = simulationService.lockOwned(userId, simulationId);
                        requireConversation(simulation.getConsultAfterSeq(), conversation);
                        boolean current =
                                simulation.getStateVersion() == input.stateVersion()
                                        && Objects.equals(
                                                latestMessageId(simulationId),
                                                input.lastMessageId());
                        String answer =
                                current
                                        ? advice.assistantMessage()
                                        : "시안이 바뀌었어요. 현재 시안에서 궁금한 점을 다시 말씀해 주세요.";
                        String code = advice.recommendedSliderCode();
                        var guidance = ConsultGuidance.forCode(code);
                        List<StoredOption> comparison =
                                current
                                                && !advice.filtered()
                                                && guidance != null
                                                && guidedControlOpen(input.request(), code)
                                        ? List.of(
                                                new StoredOption(
                                                        ADVICE_COMPARISON,
                                                        guidance.label(),
                                                        List.of(),
                                                        input.stateVersion(),
                                                        null,
                                                        code))
                                        : current && !advice.filtered()
                                                ? nullToEmpty(advice.options()).stream()
                                                        .filter(
                                                                o ->
                                                                        o.guideCode() != null
                                                                                && guidedControlOpen(
                                                                                        input
                                                                                                .request(),
                                                                                        o
                                                                                                .guideCode()))
                                                        .map(
                                                                o ->
                                                                        new StoredOption(
                                                                                ADVICE_CHOICE_PREFIX
                                                                                        + UUID
                                                                                                .randomUUID(),
                                                                                o.label(),
                                                                                List.of(),
                                                                                input
                                                                                        .stateVersion(),
                                                                                null,
                                                                                o.guideCode()))
                                                        .toList()
                                                : List.of();
                        boolean clarify = !comparison.isEmpty() && advice.needsClarification();
                        if (current
                                && !advice.filtered()
                                && advice.profileSection() != null
                                && SpringConsultClient.PROFILE_SECTIONS.contains(
                                        advice.profileSection())) {
                            comparison =
                                    List.of(
                                            new StoredOption(
                                                    "profile:" + advice.profileSection(),
                                                    "",
                                                    List.of(),
                                                    input.stateVersion(),
                                                    null,
                                                    null));
                            clarify = false;
                            code = null;
                        }
                        return saveTurn(
                                simulation,
                                advice.maskedUserContent(),
                                advice.masked(),
                                answer,
                                clarify ? "CLARIFY" : "REPLY",
                                clarify,
                                comparison,
                                advice.filtered(),
                                List.of(),
                                List.of(),
                                comparison.isEmpty() || clarify ? null : code,
                                null);
                    });
        }
        if (directControl != null) {
            if (modeSwitch != null
                    || optionId != null
                    || request.exampleId() != null
                    || directControl.stateVersion() == null
                    || ConsultGuidance.forCode(directControl.code()) == null) {
                throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
            }
            if (GuidedConsultRequest.parseDirect(content) != null
                    || !SpringConsultClient.hasExplicitTarget(content)) {
                return sendDirectControl(
                        userId,
                        simulationId,
                        content,
                        request.requestId(),
                        directControl,
                        conversation);
            }
        }
        if (modeSwitch != null && (optionId != null || ConsultCommand.parse(content).isPresent())) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        if (optionId != null && !optionId.isBlank()) {
            return writeTx.execute(s -> selectOption(userId, simulationId, optionId, conversation));
        }
        Optional<ConsultCommand> command = ConsultCommand.parse(content);
        if (command.isPresent()) {
            if (command.get() == ConsultCommand.UNDO || command.get() == ConsultCommand.REDO) {
                int step = command.get() == ConsultCommand.UNDO ? -1 : 1;
                Simulation snapshot = ownedReadable(userId, simulationId);
                int version = snapshot.getStateVersion();
                EyeEditService.Proof proof = null;
                WeightShapeEditGuard.Proof compositeProof = null;
                if (step < 0
                        ? simulationService.canUndo(snapshot)
                        : simulationService.canRedo(snapshot)) {
                    proof =
                            simulationService.prepareHistoryRestore(
                                    userId, simulationId, version, step);
                    compositeProof =
                            simulationService.prepareCompositeHistoryRestore(
                                    userId, simulationId, version, step);
                }
                EyeEditService.Proof prepared = proof;
                WeightShapeEditGuard.Proof preparedComposite = compositeProof;
                return writeTx.execute(
                        s ->
                                runCommand(
                                        userId,
                                        simulationId,
                                        command.get(),
                                        content,
                                        version,
                                        prepared,
                                        preparedComposite,
                                        conversation));
            }
            return writeTx.execute(
                    s ->
                            runCommand(
                                    userId,
                                    simulationId,
                                    command.get(),
                                    content,
                                    -1,
                                    null,
                                    null,
                                    conversation));
        }
        Optional<ConsultCorrection.Intent> correction = ConsultCorrection.parse(content);
        if (correction.isPresent()) {
            if (modeSwitch != null) throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
            ContourSupport contour = contourSupport(userId, simulationId);
            return writeTx.execute(
                    s ->
                            correct(
                                    userId,
                                    simulationId,
                                    content,
                                    correction.get(),
                                    contour,
                                    conversation));
        }
        ContourSupport contour = contourSupport(userId, simulationId);
        ConsultationInput input =
                readTx.execute(
                        s ->
                                buildAiRequest(
                                        userId,
                                        simulationId,
                                        content,
                                        request.requestId(),
                                        contour,
                                        modeSwitch));
        requireConversation(input.conversation(), conversation);
        var followUp = GuidedConsultRequest.parse(content);
        if (comparisonTarget == null
                && modeSwitch == null
                && followUp != null
                && input.guidance() != null) {
            if (!preview && ADVICE_COMPARISON.equals(input.guidance().option().id())) {
                return writeTx.execute(
                        s -> {
                            Simulation simulation =
                                    simulationService.lockOwned(userId, simulationId);
                            requireConversation(simulation.getConsultAfterSeq(), conversation);
                            return reply(
                                    simulation,
                                    content,
                                    "상담 답변 아래에서 3D 비교를 이어가면 저장 전에 확인할 수 있어요. "
                                            + ConsultGuidance.UNCHANGED,
                                    "REPLY",
                                    null);
                        });
            }
            return writeTx.execute(
                    s -> saveGuidedFollowUp(userId, simulationId, content, input, followUp));
        }
        var selection = input.guidance();
        boolean comparisonFollowUp =
                preview
                        && modeSwitch == null
                        && selection != null
                        && ADVICE_COMPARISON.equals(selection.option().id())
                        && selection.option().stateVersion() == input.stateVersion();
        AiConsult.Response reply =
                comparisonTarget != null
                        ? aiClient.consultPreview(input.request(), comparisonTarget)
                        : comparisonFollowUp
                                ? aiClient.consultComparison(
                                        input.request(), selection.option().guideCode())
                                : preview
                                        ? aiClient.consultPreview(input.request())
                                        : aiClient.consult(input.request());
        return writeTx.execute(
                s ->
                        saveAiReply(
                                userId,
                                simulationId,
                                reply,
                                modeSwitch,
                                input.stateVersion(),
                                conversation,
                                preview,
                                comparisonFollowUp ? selection : null));
    }

    /** API-CON-02. seq 오름차순. */
    @Transactional(readOnly = true)
    public ConsultMessageListResponse messages(
            String userId, String simulationId, int page, int size, boolean archived) {
        int boundary = ownedReadable(userId, simulationId).getConsultAfterSeq();
        int safePage = Math.max(page, 0);
        int safeSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
        var order = PageRequest.of(safePage, safeSize, Sort.by(Sort.Order.asc("seq")));
        Page<ConsultMessage> result =
                archived
                        ? messageRepository.findBySimulationIdAndSeqLessThanEqual(
                                simulationId, boundary, order)
                        : boundary == 0
                                ? messageRepository.findBySimulationId(simulationId, order)
                                : messageRepository.findBySimulationIdAndSeqGreaterThan(
                                        simulationId, boundary, order);
        List<String> ids = result.getContent().stream().map(ConsultMessage::getId).toList();
        Map<String, ChangeRequest> requests =
                ids.isEmpty()
                        ? Map.of()
                        : changeRequestRepository.findByConsultMessageIdIn(ids).stream()
                                .collect(
                                        Collectors.toMap(
                                                ChangeRequest::getConsultMessageId,
                                                Function.identity()));
        List<ConsultMessageListResponse.Item> items =
                result.getContent().stream().map(m -> toItem(m, requests.get(m.getId()))).toList();
        return new ConsultMessageListResponse(
                items, safePage, safeSize, result.getTotalElements(), boundary);
    }

    @Transactional
    public int newConversation(String userId, String simulationId) {
        Simulation simulation = simulationService.lockOwned(userId, simulationId);
        int boundary =
                Math.max(
                        messageRepository.maxSeq(simulationId),
                        simulation.getConsultAfterSeq() + 1);
        simulation.startConversation(boundary);
        return boundary;
    }

    private static void requireConversation(int actual, int expected) {
        if (actual != expected) {
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE, "conversation changed");
        }
    }

    private boolean activeRequest(Simulation simulation, ChangeRequest request) {
        return simulation.getConsultAfterSeq() == 0
                || messageRepository
                        .findById(request.getConsultMessageId())
                        .filter(m -> m.getSeq() > simulation.getConsultAfterSeq())
                        .isPresent();
    }

    /**
     * API-EDIT-05. 후보를 서버에서 실제값으로 바꿔 한 거래(CHAT 이력 1건)로 저장한다. FE가 보낸 조절값은 받지 않는다.
     *
     * <p>순서: 시안 잠금(404) → 변경 요청 확인(404·CON_010) → 3D 채팅 적용 허용(EDIT_030) → {@code
     * stateVersion}(EDIT_002) → 저장 코드·범위 검증(CON_010) → clamp·기록.
     *
     * <p>EDIT_030은 서버 최종 형상 검사가 준비되지 않은 3D다({@code face_model.chat_apply_ready = false}). 얼굴·{@code
     * stateVersion}·이력·undo를 바꾸지 않고 변경 요청도 {@code COMPLETE}로 남겨, 후보·되묻기는 CON-01·02로 계속 보인다.
     */
    public ApplyChangeRequestResponse apply(
            String userId, String simulationId, String requestId, int stateVersion) {
        return evaluate(userId, simulationId, requestId, stateVersion, false);
    }

    public ApplyChangeRequestResponse preview(
            String userId, String simulationId, String requestId, int stateVersion) {
        return evaluate(userId, simulationId, requestId, stateVersion, true);
    }

    private ApplyChangeRequestResponse evaluate(
            String userId,
            String simulationId,
            String requestId,
            int stateVersion,
            boolean preview) {
        ContourSupport contour = contourSupport(userId, simulationId);
        ApplyProof proof = prepareApply(userId, simulationId, requestId, stateVersion);
        if (proof.contour() != null
                && !Objects.equals(contour.meshKey(), proof.contour().meshKey()))
            throw new BusinessException(EditErrorCode.UNSAFE_CONTOUR_EDIT);
        return writeTx.execute(
                s ->
                        applyLocked(
                                userId,
                                simulationId,
                                requestId,
                                stateVersion,
                                proof,
                                contour,
                                preview));
    }

    private record ContourProof(
            String modelId,
            String meshKey,
            String rigKey,
            String noseApproval,
            String eyeApproval,
            Map<String, Double> weights,
            EyeEditState eyeState) {
        boolean matches(FaceModel model) {
            return model != null
                    && !model.isDeleted()
                    && Objects.equals(modelId, model.getId())
                    && Objects.equals(meshKey, model.getMeshObjectKey())
                    && Objects.equals(rigKey, model.getRigObjectKey())
                    && Objects.equals(noseApproval, model.getApprovedNoseCapabilities())
                    && Objects.equals(eyeApproval, model.getApprovedEyeCapabilities());
        }
    }

    private record ApplyProof(
            EyeEditService.Proof eyes, WeightShapeEditGuard.Proof composite, ContourProof contour) {
        ApplyProof(EyeEditService.Proof eyes, WeightShapeEditGuard.Proof composite) {
            this(eyes, composite, null);
        }
    }

    private static boolean multipleContourActions(List<EditAction> actions) {
        return actions.stream()
                        .filter(
                                a ->
                                        a.code().startsWith("contour.")
                                                && !WEIGHT_CODE.equals(a.code()))
                        .count()
                > 1;
    }

    private static Map<String, Double> contourWeights(Map<String, Double> weights) {
        var result = new TreeMap<String, Double>();
        weights.forEach(
                (code, value) -> {
                    if ((code.startsWith("nose.") || code.startsWith("contour."))
                            && !WEIGHT_CODE.equals(code)
                            && value != 0) result.put(code, value);
                });
        return result;
    }

    private static boolean needsFaceProof(List<EditAction> actions) {
        return multipleContourActions(actions)
                || (actions.stream().noneMatch(a -> WEIGHT_CODE.equals(a.code()))
                        && actions.stream().map(a -> a.code().split("\\.", 2)[0]).distinct().count()
                                > 1);
    }

    private ApplyProof prepareApply(
            String userId, String simulationId, String requestId, int stateVersion) {
        Simulation simulation = ownedReadable(userId, simulationId);
        ChangeRequest changeRequest =
                changeRequestRepository
                        .findByIdAndSimulationId(requestId, simulationId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        if (!activeRequest(simulation, changeRequest))
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE, "conversation changed");
        if (changeRequest.getStatus() != ChangeRequestStatus.COMPLETE)
            return new ApplyProof(null, null);
        SimulationService.checkVersion(simulation, stateVersion);
        StoredRequest stored = json.readRequest(changeRequest.getRequestJson());
        checkGuidanceVersion(simulation, stored);
        List<EditAction> eyeActions =
                stored.actions().stream().filter(a -> a.code().startsWith("eye.")).toList();
        MorphState current = transitionBase(simulation, stored.modeSwitch());
        if (needsFaceProof(stored.actions())) {
            if (weightActive(current) || !current.pointStrokes().isEmpty()) {
                throw new BusinessException(EditErrorCode.UNSAFE_CONTOUR_EDIT);
            }
            var ranges = morphParameterService.ranges(current.schemaVersion());
            var morphActions =
                    stored.actions().stream().filter(a -> !a.code().startsWith("eye.")).toList();
            var candidate =
                    MorphEdits.apply(
                            current.weights(),
                            requestedEdits(simulation, current, morphActions, ranges),
                            ranges);
            var weights = contourWeights(candidate.weights());
            var model = faceModelRepository.findById(simulation.getFaceModelId()).orElse(null);
            if (model == null || candidate.changes().stream().anyMatch(c -> c.from() == c.to()))
                throw new BusinessException(EditErrorCode.UNSAFE_CONTOUR_EDIT);
            EyeEditState before =
                    current.eyeEdit() == null ? EyeEditState.initial() : current.eyeEdit();
            EyeEditState eyes = before;
            if (!eyeActions.isEmpty()) {
                var edits =
                        EyeConsultEdits.apply(
                                before, eyeActions, eyeEditService.support(model.getId()));
                if (!edits.unchangedCodes().isEmpty() || edits.state().equals(before))
                    throw new BusinessException(EditErrorCode.UNSAFE_CONTOUR_EDIT);
                eyes = edits.state();
            }
            EyeEditState activeEyes = EyeEditState.initial().equals(eyes) ? null : eyes;
            boolean hasNose = weights.keySet().stream().anyMatch(code -> code.startsWith("nose."));
            boolean hasContour =
                    weights.keySet().stream().anyMatch(code -> code.startsWith("contour."));
            if (activeEyes != null && !weights.isEmpty() || hasNose && hasContour) {
                weightContourEditService.requireSafeFace(model, weights, activeEyes);
            } else if (hasContour && weights.size() > 1) {
                weightContourEditService.requireSafeContour(model, weights);
            }
            return new ApplyProof(
                    eyeActions.isEmpty()
                            ? eyeEditService.preparePreserved(simulation, current.eyeEdit())
                            : eyeEditService.prepare(simulation, eyes),
                    null,
                    new ContourProof(
                            model.getId(),
                            model.getMeshObjectKey(),
                            model.getRigObjectKey(),
                            model.getApprovedNoseCapabilities(),
                            model.getApprovedEyeCapabilities(),
                            weights,
                            eyes));
        }
        EyeEditState before =
                current.eyeEdit() == null ? EyeEditState.initial() : current.eyeEdit();
        if (stored.correction() != null) {
            var correction = stored.correction();
            var target = correctionTarget(simulation, correction);
            if (correction.control().eye()) {
                var eyes =
                        EyeConsultEdits.restore(
                                current.eyeEdit(),
                                target.before().eyeEdit(),
                                correction.control(),
                                correction.partial());
                return new ApplyProof(eyeEditService.prepare(simulation, eyes), null);
            }
            return new ApplyProof(
                    eyeEditService.preparePreserved(simulation, current.eyeEdit()), null);
        }
        if (eyeActions.isEmpty())
            return new ApplyProof(
                    eyeEditService.preparePreserved(simulation, current.eyeEdit()),
                    prepareCompositeApply(
                            simulation, current, stored.actions(), current.eyeEdit()));
        EyeEditState candidate =
                EyeConsultEdits.apply(
                                before,
                                eyeActions,
                                eyeEditService.support(simulation.getFaceModelId()))
                        .state();
        return new ApplyProof(
                before.equals(candidate)
                        ? eyeEditService.preparePreserved(simulation, current.eyeEdit())
                        : eyeEditService.prepare(simulation, candidate),
                prepareCompositeApply(
                        simulation,
                        current,
                        stored.actions(),
                        before.equals(candidate) ? current.eyeEdit() : candidate));
    }

    private WeightShapeEditGuard.Proof prepareCompositeApply(
            Simulation simulation,
            MorphState current,
            List<EditAction> actions,
            EyeEditState eyes) {
        if (actions.isEmpty()
                || (!weightActive(current)
                        && actions.stream()
                                .noneMatch(action -> WEIGHT_CODE.equals(action.code())))) {
            return null;
        }
        List<EditAction> morph =
                actions.stream()
                        .filter(
                                action ->
                                        action.code().startsWith("nose.")
                                                || action.code().startsWith("contour."))
                        .toList();
        var ranges = morphParameterService.ranges(current.schemaVersion());
        var candidate =
                MorphEdits.apply(
                        current.weights(),
                        requestedEdits(simulation, current, morph, ranges),
                        ranges);
        return weightContourEditService.prepare(
                simulation,
                WeightShapeEditGuard.requireExclusive(
                        new MorphState(
                                current.schemaVersion(),
                                candidate.weights(),
                                current.pointStrokes(),
                                eyes)));
    }

    private ApplyChangeRequestResponse applyLocked(
            String userId,
            String simulationId,
            String requestId,
            int stateVersion,
            ApplyProof proof,
            ContourSupport contour,
            boolean preview) {
        eyeEditService.lockProofModel(userId, proof.eyes());
        simulationService.lockCompositeProofModel(userId, proof.composite());
        if (proof.contour() != null) {
            faceModelRepository
                    .findOwnedForUpdate(proof.contour().modelId(), userId)
                    .filter(proof.contour()::matches)
                    .orElseThrow(() -> new BusinessException(EditErrorCode.UNSAFE_CONTOUR_EDIT));
        }
        Simulation simulation = simulationService.lockOwned(userId, simulationId);
        ChangeRequest changeRequest =
                changeRequestRepository
                        .findByIdAndSimulationId(requestId, simulationId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        if (!activeRequest(simulation, changeRequest))
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE, "conversation changed");
        if (changeRequest.getStatus() != ChangeRequestStatus.COMPLETE) {
            throw new BusinessException(
                    ConsultErrorCode.NOT_APPLICABLE, "status " + changeRequest.getStatus());
        }
        FaceModel model = faceModelRepository.findById(simulation.getFaceModelId()).orElse(null);
        boolean chatApplyReady = model != null && model.isChatApplyReady();
        SimulationService.checkVersion(simulation, stateVersion);

        StoredRequest stored = json.readRequest(changeRequest.getRequestJson());
        checkGuidanceVersion(simulation, stored);
        MorphState current = transitionBase(simulation, stored.modeSwitch());
        var correction = stored.correction();
        if (preview && (stored.modeSwitch() != null || correction != null)) {
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
        }
        var target = correction == null ? null : correctionTarget(simulation, correction);
        if (stored.modeSwitch() != null && !matchesMode(stored.modeSwitch(), stored.actions())) {
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
        }
        List<EditAction> morphActions =
                stored.actions().stream()
                        .filter(
                                a ->
                                        a.code().startsWith("nose.")
                                                || a.code().startsWith("contour."))
                        .toList();
        List<EditAction> eyeActions =
                stored.actions().stream().filter(a -> a.code().startsWith("eye.")).toList();
        if (morphActions.size() + eyeActions.size() != stored.actions().size()) {
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE, "unsupported action");
        }
        if (morphActions.stream()
                .anyMatch(
                        a ->
                                a.code().startsWith("contour.")
                                        && !a.code().equals(WEIGHT_CODE)
                                        && (!contour.matches(model)
                                                || !contour.codes().contains(a.code())))) {
            throw new BusinessException(EditErrorCode.CHAT_APPLY_NOT_SUPPORTED);
        }
        if ((!chatApplyReady && morphActions.stream().anyMatch(a -> a.code().startsWith("nose.")))
                || (morphActions.stream().anyMatch(a -> a.code().equals(WEIGHT_CODE))
                        && !simulationService.weightShapeSupported(simulation.getFaceModelId()))) {
            throw new BusinessException(
                    EditErrorCode.CHAT_APPLY_NOT_SUPPORTED, "chat apply not ready");
        }
        Map<String, MorphRange> ranges = morphParameterService.ranges(current.schemaVersion());
        EyeEditState eyeBefore =
                current.eyeEdit() == null ? EyeEditState.initial() : current.eyeEdit();
        EyeEditService.Support eyeSupport = null;
        EyeConsultEdits.Applied eyes = null;
        if (!eyeActions.isEmpty()) {
            eyeSupport = eyeEditService.support(simulation.getFaceModelId());
            eyes =
                    target == null
                            ? EyeConsultEdits.apply(eyeBefore, eyeActions, eyeSupport)
                            : new EyeConsultEdits.Applied(
                                    EyeConsultEdits.restore(
                                            eyeBefore,
                                            target.before().eyeEdit(),
                                            correction.control(),
                                            correction.partial()),
                                    false,
                                    List.of(eyeActions.getFirst().code()),
                                    List.of());
        }
        boolean eyeChanged = eyes != null && !eyeBefore.equals(eyes.state());
        List<MorphEdits.Requested> requested =
                target == null
                        ? requestedEdits(simulation, current, morphActions, ranges)
                        : target.weights(current, correction.partial());
        MorphEdits.Applied requestedMorph = MorphEdits.apply(current.weights(), requested, ranges);
        if (needsFaceProof(stored.actions())
                && (proof.contour() == null
                        || !proof.contour().matches(model)
                        || !contourWeights(requestedMorph.weights())
                                .equals(proof.contour().weights())
                        || !Objects.equals(
                                eyes == null ? eyeBefore : eyes.state(),
                                proof.contour().eyeState()))) {
            throw new BusinessException(EditErrorCode.UNSAFE_CONTOUR_EDIT);
        }
        if (target != null && requestedMorph.clamped())
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
        boolean requestedMorphChanged =
                requestedMorph.changes().stream().anyMatch(c -> c.from() != c.to());
        if (!requestedMorphChanged && !eyeChanged) {
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE, "no safe change");
        }
        MorphEdits.Applied applied =
                requestedMorph.changes().isEmpty()
                        ? null
                        : noseEditService.validate(
                                simulation,
                                current.weights(),
                                requestedMorph,
                                ranges,
                                current.pointStrokes(),
                                true);
        if (target != null
                && applied != null
                && !applied.weights().equals(requestedMorph.weights()))
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
        if (proof.contour() != null
                && applied != null
                && !applied.weights().equals(requestedMorph.weights()))
            throw new BusinessException(EditErrorCode.UNSAFE_CONTOUR_EDIT);
        List<MorphEdits.Change> effectiveMorphChanges =
                applied == null
                        ? List.of()
                        : applied.changes().stream().filter(c -> c.from() != c.to()).toList();
        boolean morphChanged = !effectiveMorphChanges.isEmpty();
        if (effectiveMorphChanges.isEmpty() && !eyeChanged) {
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE, "no safe change");
        }
        String summary =
                !effectiveMorphChanges.isEmpty()
                        ? MorphEdits.summary(effectiveMorphChanges, ranges)
                        : EyeConsultEdits.summary(eyes.changedCodes());
        if (!effectiveMorphChanges.isEmpty() && eyeChanged) {
            summary =
                    summary.replaceFirst(" 변경$", "")
                            + ", "
                            + EyeConsultEdits.summary(eyes.changedCodes());
        }
        List<AppliedChange> appliedChanges =
                morphChanged
                        ? effectiveMorphChanges.stream()
                                .map(
                                        c ->
                                                new AppliedChange(
                                                        c.code(), c.from(), c.to(), c.clamped()))
                                .toList()
                        : List.of();
        List<SkippedClause> skipped = new ArrayList<>(nullToEmpty(stored.skipped()));
        if (eyes != null) {
            for (String code : eyes.unchangedCodes()) {
                stored.actions().stream()
                        .filter(a -> code.equals(a.code()))
                        .map(EditAction::source)
                        .filter(
                                source ->
                                        source != null
                                                && stored.sourceText() != null
                                                && stored.sourceText().contains(source))
                        .findFirst()
                        .ifPresent(
                                source ->
                                        skipped.add(
                                                new SkippedClause(
                                                        source, "현재 조절 한계에서 더 바뀌지 않았어요.")));
            }
        }
        boolean limited = (morphChanged && applied.clamped()) || (eyes != null && eyes.limited());
        EyeEditState savedEyeBefore = eyeChanged ? eyeBefore : null;
        EyeEditState savedEyeAfter = eyeChanged ? eyes.state() : null;
        Map<String, Double> eyeLimits = eyeChanged ? eyeSupport.capabilities().limits() : null;
        if (preview) {
            if (!skipped.isEmpty()) {
                throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
            }
            return new ApplyChangeRequestResponse(
                    new MorphState(
                            current.schemaVersion(),
                            morphChanged ? applied.weights() : current.weights(),
                            current.pointStrokes(),
                            eyeChanged ? savedEyeAfter : current.eyeEdit()),
                    stateVersion,
                    simulation.getCurrentSeq(),
                    simulation.getCurrentSeq(),
                    appliedChanges,
                    savedEyeBefore,
                    savedEyeAfter,
                    eyeLimits,
                    skipped,
                    limited,
                    summary,
                    simulationService.canUndo(simulation),
                    simulationService.canRedo(simulation));
        }
        EditResultResponse result =
                simulationService.recordChatCombined(
                        simulation,
                        stored.modeSwitch() == null ? null : current,
                        morphChanged ? applied : null,
                        eyeChanged ? eyes.state() : null,
                        proof.eyes(),
                        proof.composite(),
                        changeRequest.getId(),
                        summary);
        ApplyResult applyResult =
                new ApplyResult(
                        summary,
                        appliedChanges,
                        skipped,
                        result.currentSeq(),
                        limited,
                        savedEyeBefore,
                        savedEyeAfter,
                        eyeLimits);
        changeRequest.markApplied(
                json.write(stored.withApplyResult(applyResult)),
                clock.instant().truncatedTo(ChronoUnit.SECONDS));
        return new ApplyChangeRequestResponse(
                result.morphState(),
                result.stateVersion(),
                result.currentSeq(),
                result.currentSeq(),
                appliedChanges,
                savedEyeBefore,
                savedEyeAfter,
                eyeLimits,
                skipped,
                limited,
                summary,
                result.canUndo(),
                result.canRedo());
    }

    private List<MorphEdits.Requested> requestedEdits(
            Simulation simulation,
            MorphState current,
            List<EditAction> actions,
            Map<String, MorphRange> ranges) {
        Map<String, MorphRange> display = new HashMap<>(ranges);
        if (actions.stream().anyMatch(a -> a.target() != null && a.code().startsWith("nose."))) {
            var capabilities = noseEditService.capabilities(simulation, ranges);
            if (capabilities == null)
                throw new BusinessException(EditErrorCode.CHAT_APPLY_NOT_SUPPORTED);
            display.keySet().removeIf(code -> code.startsWith("nose."));
            capabilities
                    .supported()
                    .forEach(
                            (code, bounds) -> {
                                var range = ranges.get(code);
                                if (range != null)
                                    display.put(
                                            code,
                                            new MorphRange(
                                                    code,
                                                    range.label(),
                                                    bounds.min(),
                                                    bounds.max()));
                            });
        }
        return actions.isEmpty()
                ? List.of()
                : ConsultEdits.requested(actions, current.weights(), ranges.keySet(), display);
    }

    private static boolean weightActive(MorphState state) {
        return state.weights().getOrDefault(WEIGHT_CODE, 0.0) != 0;
    }

    private MorphState transitionBase(Simulation simulation, ModeSwitch modeSwitch) {
        MorphState state = codec.read(simulation.getMorphState());
        if (modeSwitch == null) return state;
        SimulationService.checkVersion(simulation, modeSwitch.stateVersion());
        if ("toWeight".equals(modeSwitch.target())
                && WeightShapeEditGuard.hasFaceEdits(state)
                && simulationService.weightShapeSupported(simulation.getFaceModelId())) {
            return SimulationService.originalMorphState(state);
        }
        if ("toFace".equals(modeSwitch.target()) && weightActive(state)) {
            var retained = new TreeMap<>(state.weights());
            retained.remove(WEIGHT_CODE);
            return new MorphState(
                    state.schemaVersion(), retained, state.pointStrokes(), state.eyeEdit());
        }
        throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
    }

    private static boolean matchesMode(ModeSwitch modeSwitch, List<EditAction> actions) {
        return !actions.isEmpty()
                && actions.stream()
                        .allMatch(
                                action ->
                                        WEIGHT_CODE.equals(action.code())
                                                == "toWeight".equals(modeSwitch.target()));
    }

    // ---- CON-01 단계 ----

    private static final String ADVICE_COMPARISON = "advice-comparison";
    private static final String ADVICE_CHOICE_PREFIX = "advice-";

    private record GuidanceSelection(String messageId, StoredOption option) {}

    private record ConsultationInput(
            AiConsult.Request request,
            int stateVersion,
            GuidanceSelection guidance,
            int conversation,
            String lastMessageId) {}

    private String latestMessageId(String simulationId) {
        return messageRepository
                .findFirstBySimulationIdOrderBySeqDesc(simulationId)
                .map(ConsultMessage::getId)
                .orElse(null);
    }

    private SendMessageResponse recommendNext(
            String userId,
            String simulationId,
            SendMessageRequest request,
            String masked,
            boolean redacted,
            int conversation) {
        String[] requested = request.profileSection().split(":");
        boolean analysis = "analysis".equals(requested[0]);
        String topic = analysis ? requested[1] : null;
        String candidates = analysis ? "next:" + requested[2] : request.profileSection();
        String prefix = analysis ? "analysis:" + topic + ":" : "next:";
        ConsultationInput input = null;
        List<String> selected = List.of();
        var measurements = request.recommendationMeasurements();
        boolean measuredRequest =
                !analysis
                        && measurements != null
                        && Double.valueOf(1).equals(measurements.get("trial-version"));
        List<NextAdjustmentEvidence.MeasuredAdvice> measuredAdvice = List.of();
        String answer = "지금은 원본에서 확인한 특징과 연결해 비교할 수 있는 조절을 찾지 못했어요.";
        if (measuredRequest) answer = "현재 시안에서 변화까지 확인한 조절을 찾지 못했어요. 신경 쓰이는 부위를 알려 주시면 함께 살펴볼게요.";
        if (!candidates.startsWith("next:none")) {
            ContourSupport contour = contourSupport(userId, simulationId);
            input =
                    readTx.execute(
                            s ->
                                    buildAiRequest(
                                            userId,
                                            simulationId,
                                            masked,
                                            request.requestId(),
                                            contour,
                                            null));
            requireConversation(input.conversation(), conversation);
            var evidence =
                    NextAdjustmentEvidence.retrieve(candidates, input.request()).stream()
                            .filter(card -> inAnalysisTopic(topic, card.candidateId()))
                            .toList();
            String revision = conversation + ":" + input.stateVersion();
            if (analysis && evidence.size() == 1) {
                selected = List.of(evidence.getFirst().candidateId());
            } else if (!evidence.isEmpty()) {
                try {
                    if (measuredRequest) {
                        boolean sameVersion =
                                Double.valueOf(input.stateVersion())
                                        .equals(measurements.get("trial-state"));
                        var trials =
                                sameVersion
                                        ? NextAdjustmentEvidence.trials(evidence, measurements)
                                        : List.<NextAdjustmentEvidence.Trial>of();
                        if (!sameVersion) {
                            answer = "시안이 바뀌었어요. 지금 상태에서 다시 추천을 요청해 주세요.";
                        }
                        if (!trials.isEmpty()) {
                            // 대화를 새로 열어도 시안과 계측 후보가 같으면 추천을 재사용한다.
                            measuredAdvice =
                                    aiClient.recommendMeasuredNext(
                                            input.request(),
                                            trials,
                                            Long.toString(input.stateVersion()));
                            selected =
                                    measuredAdvice.stream()
                                            .map(advice -> advice.trial().evidence().candidateId())
                                            .toList();
                        }
                    } else {
                        selected =
                                aiClient.recommendNext(
                                        input.request(),
                                        evidence,
                                        measurements,
                                        revision,
                                        analysis);
                    }
                } catch (BusinessException e) {
                    if (e.errorCode() != ConsultErrorCode.AI_TIMEOUT
                            && e.errorCode() != ConsultErrorCode.AI_UNAVAILABLE) throw e;
                    answer = "지금은 추천 근거를 확인하지 못했어요. 잠시 후 다시 요청해 주세요.";
                }
            }
        }
        String section =
                prefix
                        + (selected.isEmpty() ? "none" : String.join(",", selected))
                        + (candidates.endsWith(":fold") ? ":fold" : "")
                        + (measuredAdvice.isEmpty()
                                ? ""
                                : ":measured:"
                                        + String.join(
                                                ",",
                                                measuredAdvice.stream()
                                                        .map(
                                                                advice -> {
                                                                    var trial = advice.trial();
                                                                    return (trial.direction()
                                                                                            .equals(
                                                                                                    "down")
                                                                                    ? "-1"
                                                                                    : "1")
                                                                            + "/"
                                                                            + trial.before()
                                                                            + "/"
                                                                            + trial.after();
                                                                })
                                                        .toList())
                                        + ":narrative");
        String reply =
                analysis
                        ? "현재 시안에서 확인할 수 있는 비율과 측정 기준이에요."
                        : selected.isEmpty()
                                ? answer
                                : measuredAdvice.isEmpty()
                                        ? "현재 시안의 3D 측정 항목과 참고 자료를 함께 확인해 고른 조절이에요."
                                        : String.join(
                                                "\n",
                                                measuredAdvice.stream()
                                                        .map(
                                                                NextAdjustmentEvidence
                                                                                .MeasuredAdvice
                                                                        ::explanation)
                                                        .toList());
        ConsultationInput snapshot = input;
        return writeTx.execute(
                s -> {
                    Simulation simulation = simulationService.lockOwned(userId, simulationId);
                    requireConversation(simulation.getConsultAfterSeq(), conversation);
                    boolean current =
                            snapshot == null
                                    || (simulation.getStateVersion() == snapshot.stateVersion()
                                            && Objects.equals(
                                                    latestMessageId(simulationId),
                                                    snapshot.lastMessageId()));
                    return saveTurn(
                            simulation,
                            masked,
                            redacted,
                            current ? reply : "시안이나 대화가 바뀌었어요. 지금 상태에서 다시 추천을 요청해 주세요.",
                            "REPLY",
                            false,
                            List.of(
                                    new StoredOption(
                                            "profile:" + (current ? section : prefix + "none"),
                                            "",
                                            List.of(),
                                            simulation.getStateVersion(),
                                            null,
                                            null)),
                            false,
                            List.of(),
                            List.of(),
                            null,
                            null);
                });
    }

    private ConsultationInput buildAiRequest(
            String userId,
            String simulationId,
            String content,
            String requestId,
            ContourSupport contour,
            ModeSwitch modeSwitch) {
        Simulation simulation = ownedReadable(userId, simulationId);
        MorphState state = transitionBase(simulation, modeSwitch);
        Map<String, MorphRange> ranges = morphParameterService.ranges(state.schemaVersion());
        var capabilities = noseEditService.capabilities(simulation, ranges);
        var eyeSupport = eyeEditService.support(simulation.getFaceModelId());
        boolean weightSupported =
                simulationService.weightShapeSupported(simulation.getFaceModelId());
        boolean contourBound =
                contour.matches(
                        faceModelRepository.findById(simulation.getFaceModelId()).orElse(null));
        var editRanges =
                SimulationService.editRanges(
                        ranges,
                        capabilities,
                        eyeSupport,
                        weightSupported,
                        contourBound ? contour.codes() : Set.of());
        List<String> allowedCodes =
                new ArrayList<>(ConsultEdits.allowedCodes(editRanges.weights().keySet()));
        allowedCodes.addAll(EyeConsultEdits.allowedCodes(eyeSupport, state.eyeEdit()));
        boolean weightResetRequired = weightSupported && WeightShapeEditGuard.hasFaceEdits(state);
        if (weightResetRequired) allowedCodes.remove(WEIGHT_CODE);
        if (modeSwitch != null) {
            allowedCodes.removeIf(
                    code -> WEIGHT_CODE.equals(code) != "toWeight".equals(modeSwitch.target()));
        }

        List<ConsultMessage> latest =
                new ArrayList<>(
                        messageRepository.findTop10BySimulationIdOrderBySeqDesc(simulationId));
        String lastMessageId = latest.isEmpty() ? null : latest.getFirst().getId();
        latest.removeIf(m -> m.getSeq() <= simulation.getConsultAfterSeq());
        Collections.reverse(latest);
        var last = latest.isEmpty() ? null : latest.getLast();
        List<AiConsult.RecentMessage> recent =
                latest.stream()
                        .filter(m -> !m.getContent().isBlank())
                        .map(
                                m ->
                                        new AiConsult.RecentMessage(
                                                m.getRole() == ConsultRole.USER
                                                        ? "user"
                                                        : "assistant",
                                                truncate(m.getContent()),
                                                m == last && m.getRole() == ConsultRole.ASSISTANT
                                                        ? json.readOptions(m.getOptions()).stream()
                                                                .filter(
                                                                        o ->
                                                                                o.id().startsWith(
                                                                                                        ADVICE_CHOICE_PREFIX)
                                                                                        && !ADVICE_COMPARISON
                                                                                                .equals(
                                                                                                        o
                                                                                                                .id())
                                                                                        && o
                                                                                                        .stateVersion()
                                                                                                == simulation
                                                                                                        .getStateVersion()
                                                                                        && o
                                                                                                        .guideCode()
                                                                                                != null)
                                                                .map(
                                                                        o ->
                                                                                new AiConsult
                                                                                        .GuidedChoice(
                                                                                        o.id(),
                                                                                        o
                                                                                                .guideCode(),
                                                                                        o.label()))
                                                                .toList()
                                                        : List.of()))
                        .toList();

        Map<String, Object> currentRequest =
                lastApplied(simulation)
                        .filter(request -> request.correction() == null)
                        .map(r -> Map.<String, Object>of("actions", r.actions()))
                        .orElse(null);

        var request =
                new AiConsult.Request(
                        simulationId,
                        requestId,
                        new AiConsult.Message(content, null),
                        currentRequest,
                        recent,
                        Map.of(),
                        new AiConsult.MorphStateBody(
                                state.schemaVersion(), state.weights(), weightResetRequired),
                        weightSupported || (contourBound && !contour.codes().isEmpty())
                                ? List.of("EYE", "NOSE", "CONTOUR")
                                : List.of("EYE", "NOSE"),
                        allowedCodes);
        GuidanceSelection guidance = null;
        if (last != null && last.getRole() == ConsultRole.ASSISTANT) {
            var options = json.readOptions(last.getOptions());
            if (options.size() == 1) {
                var option = options.getFirst();
                if (option.guideCode() != null
                        && ("REPLY".equals(last.getIntent())
                                || ("CLARIFY".equals(last.getIntent())
                                        && last.isNeedsClarification()
                                        && option.correction() == null
                                        && !option.id().startsWith(ADVICE_CHOICE_PREFIX)))) {
                    guidance = new GuidanceSelection(last.getId(), option);
                }
            }
        }
        return new ConsultationInput(
                request,
                simulation.getStateVersion(),
                guidance,
                simulation.getConsultAfterSeq(),
                lastMessageId);
    }

    private SendMessageResponse saveGuidedFollowUp(
            String userId,
            String simulationId,
            String content,
            ConsultationInput input,
            GuidedConsultRequest followUp) {
        Simulation simulation = simulationService.lockOwned(userId, simulationId);
        requireConversation(simulation.getConsultAfterSeq(), input.conversation());
        var selection = input.guidance();
        var option = selection.option();
        var request = input.request();
        if (option.stateVersion() != simulation.getStateVersion()
                || input.stateVersion() != simulation.getStateVersion()
                || messageRepository
                        .findFirstBySimulationIdOrderBySeqDesc(simulationId)
                        .filter(m -> m.getId().equals(selection.messageId()))
                        .isEmpty()) {
            return reply(
                    simulation,
                    content,
                    "그사이 시안이나 대화가 바뀌었어요. 조절할 부위와 방향을 다시 말씀해 주세요. " + ConsultGuidance.UNCHANGED,
                    "REPLY",
                    null);
        }
        return saveGuidedAction(simulation, content, request, option.guideCode(), followUp);
    }

    private SendMessageResponse sendDirectControl(
            String userId,
            String simulationId,
            String content,
            String requestId,
            SendMessageRequest.DirectControl selection,
            int conversation) {
        var followUp = GuidedConsultRequest.parseDirect(content);
        // 제한된 방향 문장만 원문으로 남긴다. 그 밖의 문장은 인물명이 포함될 수 있다.
        String safeContent = followUp == null ? "[선택한 조절의 방향을 확인하지 못한 요청]" : content;
        var contour = contourSupport(userId, simulationId);
        var input =
                readTx.execute(
                        s ->
                                buildAiRequest(
                                        userId,
                                        simulationId,
                                        safeContent,
                                        requestId,
                                        contour,
                                        null));
        return writeTx.execute(
                s -> {
                    var simulation = simulationService.lockOwned(userId, simulationId);
                    requireConversation(simulation.getConsultAfterSeq(), conversation);
                    if (input.stateVersion() != selection.stateVersion()
                            || simulation.getStateVersion() != selection.stateVersion()) {
                        return saveTurn(
                                simulation,
                                safeContent,
                                followUp == null,
                                "그사이 시안이 바뀌었어요. 직접 조절에서 항목을 다시 골라 주세요. "
                                        + ConsultGuidance.UNCHANGED,
                                "REPLY",
                                false,
                                List.of(),
                                false,
                                List.of(),
                                List.of(),
                                null,
                                null);
                    }
                    if (followUp == null) {
                        return saveTurn(
                                simulation,
                                safeContent,
                                true,
                                guidedControlOpen(input.request(), selection.code())
                                        ? ConsultGuidance.forCode(selection.code()).answer()
                                        : ConsultGuidance.UNAVAILABLE,
                                "REPLY",
                                false,
                                List.of(),
                                false,
                                List.of(),
                                List.of(),
                                null,
                                null);
                    }
                    return saveGuidedAction(
                            simulation, safeContent, input.request(), selection.code(), followUp);
                });
    }

    private SendMessageResponse saveGuidedAction(
            Simulation simulation,
            String content,
            AiConsult.Request request,
            String code,
            GuidedConsultRequest followUp) {
        if (!guidedControlOpen(request, code)) {
            return reply(simulation, content, ConsultGuidance.UNAVAILABLE, "REPLY", null);
        }
        EditAction action = followUp == null ? null : followUp.action(code, content);
        if (action == null) {
            return reply(
                    simulation, content, ConsultGuidance.forCode(code).answer(), "REPLY", null);
        }
        return saveTurn(
                simulation,
                content,
                false,
                "",
                "EDIT",
                false,
                List.of(),
                false,
                List.of(action),
                List.of(),
                null,
                null,
                null,
                null,
                simulation.getStateVersion());
    }

    private static boolean guidedControlOpen(AiConsult.Request request, String code) {
        return SpringConsultClient.guidanceOpen(code, request.allowedCodes(), request.morphState())
                && (!"nose.tip_height".equals(code)
                        || request.allowedCodes().contains("nose.tip_rotation"));
    }

    private static AiConsult.Response profileComparisonAdvice(
            AiConsult.Request request, String section) {
        boolean lower = "lower".equals(section);
        var candidates =
                lower
                        ? List.of(
                                "contour.jaw_angle",
                                "contour.chin_width",
                                "contour.chin_length",
                                "contour.chin_projection")
                        : List.of(
                                "eye.inner",
                                "eye.outer",
                                "eye.upper",
                                "eye.lower",
                                "eye.height",
                                "eye.style_inline",
                                "eye.style_inout",
                                "eye.style_outline",
                                "nose.bridge_height",
                                "nose.alar_width",
                                "nose.tip_projection",
                                "nose.tip_height");
        var options =
                candidates.stream()
                        .filter(code -> guidedControlOpen(request, code))
                        .map(
                                code ->
                                        new AiConsult.Option(
                                                ConsultGuidance.forCode(code).label(), code))
                        .toList();
        String answer =
                options.isEmpty()
                        ? "현재 시안에서는 이 부위를 3D로 조절해 비교하기 어려워요. 비율과 측정 기준은 위에서 볼 수 있어요."
                        : "이 시안에서 비교할 수 있는 항목이에요. 먼저 보고 싶은 부분을 골라 주세요.";
        String label = lower ? "인중·턱에서" : "눈·코에서";
        return new AiConsult.Response(
                label + " 비교할 조절을 찾고 싶어요.",
                false,
                answer,
                "REPLY",
                null,
                !options.isEmpty(),
                options,
                false,
                null);
    }

    private static void checkGuidanceVersion(Simulation simulation, StoredRequest stored) {
        if (stored.guidanceStateVersion() != null) {
            SimulationService.checkVersion(simulation, stored.guidanceStateVersion());
        }
    }

    private record ContourSupport(
            String modelId,
            String meshKey,
            String weightApproval,
            String noseApproval,
            Set<String> codes) {
        boolean matches(FaceModel model) {
            return model != null
                    && !model.isDeleted()
                    && Objects.equals(modelId, model.getId())
                    && Objects.equals(meshKey, model.getMeshObjectKey())
                    && Objects.equals(weightApproval, model.getApprovedWeightShape())
                    && Objects.equals(noseApproval, model.getApprovedNoseCapabilities());
        }
    }

    private ContourSupport contourSupport(String userId, String simulationId) {
        Simulation simulation = ownedReadable(userId, simulationId);
        FaceModel model = faceModelRepository.findById(simulation.getFaceModelId()).orElse(null);
        if (model == null) {
            return new ContourSupport(null, null, null, null, Set.of());
        }
        return new ContourSupport(
                model.getId(),
                model.getMeshObjectKey(),
                model.getApprovedWeightShape(),
                model.getApprovedNoseCapabilities(),
                weightShapeApproval.supportedContourCodes(model));
    }

    private SendMessageResponse saveAiReply(
            String userId,
            String simulationId,
            AiConsult.Response reply,
            ModeSwitch modeSwitch,
            int askedAtVersion,
            int conversation,
            boolean preview,
            GuidanceSelection comparisonSelection) {
        Simulation simulation = simulationService.lockOwned(userId, simulationId);
        requireConversation(simulation.getConsultAfterSeq(), conversation);
        if (preview) SimulationService.checkVersion(simulation, askedAtVersion);
        if (comparisonSelection != null
                && !Objects.equals(
                        comparisonSelection.messageId(), latestMessageId(simulationId))) {
            return reply(
                    simulation,
                    reply.maskedUserContent(),
                    "그사이 대화가 바뀌었어요. 비교할 부위를 다시 골라 주세요. " + ConsultGuidance.UNCHANGED,
                    "REPLY",
                    null);
        }
        if (reply.needsClarification() && askedAtVersion != simulation.getStateVersion()) {
            return saveTurn(
                    simulation,
                    reply.maskedUserContent(),
                    reply.masked(),
                    "그사이 시안이 바뀌었어요. 원하는 조절을 다시 말씀해 주세요. 얼굴은 그대로예요.",
                    "CLARIFY",
                    true,
                    List.of(),
                    false,
                    List.of(),
                    List.of(),
                    null,
                    null);
        }
        List<StoredOption> options =
                nullToEmpty(reply.options()).stream()
                        .map(
                                o ->
                                        new StoredOption(
                                                UUID.randomUUID().toString(),
                                                o.label(),
                                                List.of(),
                                                askedAtVersion,
                                                null,
                                                o.guideCode()))
                        .toList();
        List<EditAction> actions =
                reply.changeRequest() == null ? List.of() : reply.changeRequest().actions();
        List<SkippedClause> skipped =
                reply.changeRequest() == null
                        ? List.of()
                        : nullToEmpty(reply.changeRequest().skipped());
        if (modeSwitch != null) {
            if (!"EDIT".equals(reply.intent())
                    || reply.filtered()
                    || !matchesMode(modeSwitch, actions)
                    || !skipped.isEmpty()
                    || reply.needsClarification()) {
                String answer = reply.assistantMessage();
                return saveTurn(
                        simulation,
                        reply.maskedUserContent(),
                        reply.masked(),
                        answer == null || answer.isBlank()
                                ? "요청한 조절을 확인하지 못했어요. 모드와 얼굴은 그대로예요. 바꾸고 싶은 항목을 다시 말씀해 주세요."
                                : answer + " 모드와 얼굴은 그대로예요.",
                        "REPLY",
                        false,
                        List.of(),
                        reply.filtered(),
                        List.of(),
                        List.of(),
                        null,
                        null);
            }
            SimulationService.checkVersion(simulation, modeSwitch.stateVersion());
        }
        return saveTurn(
                simulation,
                reply.maskedUserContent(),
                reply.masked(),
                reply.assistantMessage() == null ? "" : reply.assistantMessage(),
                reply.intent(),
                reply.needsClarification(),
                options,
                reply.filtered(),
                actions,
                skipped,
                reply.recommendedSliderCode(),
                null,
                modeSwitch,
                null,
                preview ? askedAtVersion : null);
    }

    /** 되묻기 선택지 선택. 시안이 그 뒤 바뀌었거나 직전 질문의 선택지가 아니면 적용하지 않고 다시 묻는다. */
    private SendMessageResponse selectOption(
            String userId, String simulationId, String optionId, int conversation) {
        Simulation simulation = simulationService.lockOwned(userId, simulationId);
        requireConversation(simulation.getConsultAfterSeq(), conversation);
        Optional<StoredOption> chosen =
                messageRepository
                        .findFirstBySimulationIdOrderBySeqDesc(simulationId)
                        .filter(
                                m ->
                                        m.getRole() == ConsultRole.ASSISTANT
                                                && m.getSeq() > simulation.getConsultAfterSeq()
                                                && m.isNeedsClarification())
                        .flatMap(
                                m ->
                                        json.readOptions(m.getOptions()).stream()
                                                .filter(o -> o.id().equals(optionId))
                                                .findFirst());
        boolean fresh =
                chosen.isPresent() && chosen.get().stateVersion() == simulation.getStateVersion();
        // 사용자 메시지는 서버가 가진 라벨로 저장한다(FE가 보낸 문장은 마스킹을 거치지 않았다).
        String userContent = chosen.map(StoredOption::label).orElse("선택지를 골랐어요.");
        if (!fresh) {
            return saveTurn(
                    simulation,
                    userContent,
                    false,
                    "그사이 시안이 바뀌어 이 선택지는 적용하지 않았어요. 바꾸고 싶은 내용을 다시 말씀해 주세요.",
                    "CLARIFY",
                    true,
                    List.of(),
                    false,
                    List.of(),
                    List.of(),
                    null,
                    null);
        }
        StoredOption option = chosen.orElseThrow();
        if (option.correction() == null) {
            ConsultGuidance guidance = ConsultGuidance.forCode(option.guideCode());
            if (guidance == null) {
                return reply(
                        simulation, userContent, "원하는 조절을 다시 말씀해 주세요. 얼굴은 그대로예요.", "REPLY", null);
            }
            // REPLY의 선택 기록은 다음 발화에만 쓰며, 다시 누를 버튼으로 돌려주지 않는다.
            return saveTurn(
                    simulation,
                    userContent,
                    false,
                    guidance.answer(),
                    "REPLY",
                    false,
                    option.id().startsWith(ADVICE_CHOICE_PREFIX)
                            ? List.of(
                                    new StoredOption(
                                            ADVICE_COMPARISON,
                                            option.label(),
                                            List.of(),
                                            option.stateVersion(),
                                            null,
                                            option.guideCode()))
                            : List.of(option),
                    false,
                    List.of(),
                    List.of(),
                    option.id().startsWith(ADVICE_CHOICE_PREFIX) ? option.guideCode() : null,
                    null);
        }
        return saveTurn(
                simulation,
                userContent,
                false,
                "",
                "EDIT",
                false,
                List.of(),
                false,
                option.actions(),
                List.of(),
                null,
                null,
                null,
                option.correction(),
                null);
    }

    private SendMessageResponse correct(
            String userId,
            String simulationId,
            String content,
            ConsultCorrection.Intent intent,
            ContourSupport contour,
            int conversation) {
        Simulation simulation = simulationService.lockOwned(userId, simulationId);
        requireConversation(simulation.getConsultAfterSeq(), conversation);
        var targets = correctionTargets(simulation, intent.targets());
        var model = faceModelRepository.findById(simulation.getFaceModelId()).orElse(null);
        var current = codec.read(simulation.getMorphState());
        var options = new ArrayList<StoredOption>();
        for (var target : targets) {
            var control = target.control();
            if (!correctionSupported(simulation, current, target, model, contour, intent.partial()))
                continue;
            var selection =
                    new ConsultCorrection.Selection(
                            control, simulation.getStateVersion(), intent.partial());
            options.add(
                    new StoredOption(
                            UUID.randomUUID().toString(),
                            control.label + (intent.partial() ? " 변경을 조금 줄이기" : " 변경 되돌리기"),
                            List.of(control.action()),
                            simulation.getStateVersion(),
                            selection,
                            null));
        }
        if (options.isEmpty())
            return reply(
                    simulation,
                    content,
                    "현재 시안에서 정정할 수 있는 상담 편집을 찾지 못했어요. 얼굴은 그대로예요.",
                    "REPLY",
                    null);
        if (options.size() == 1
                && intent.targets().size() < ConsultCorrection.Control.values().length) {
            var chosen = options.getFirst();
            return saveTurn(
                    simulation,
                    content,
                    false,
                    "",
                    "EDIT",
                    false,
                    List.of(),
                    false,
                    chosen.actions(),
                    List.of(),
                    null,
                    null,
                    null,
                    chosen.correction(),
                    null);
        }
        return saveTurn(
                simulation,
                content,
                false,
                "어느 조절을 정정할까요? 얼굴은 그대로예요.",
                "CLARIFY",
                true,
                options,
                false,
                List.of(),
                List.of(),
                null,
                null);
    }

    private boolean correctionSupported(
            Simulation simulation,
            MorphState current,
            ConsultCorrection.Target target,
            FaceModel model,
            ContourSupport contour,
            boolean partial) {
        var control = target.control();
        if (control.eye()) {
            if (partial && control == ConsultCorrection.Control.FOLD) return false;
            var support = eyeEditService.support(simulation.getFaceModelId());
            var allowed = EyeConsultEdits.allowedCodes(support, current.eyeEdit());
            return control == ConsultCorrection.Control.FOLD
                    ? allowed.stream().anyMatch(code -> code.startsWith("eye.style_"))
                    : allowed.contains(control.code);
        }
        if (control == ConsultCorrection.Control.WEIGHT) {
            return simulationService.weightShapeSupported(simulation.getFaceModelId())
                    && !WeightShapeEditGuard.hasFaceEdits(current);
        }
        if (weightActive(current)) return false;
        if (control.code.startsWith("nose.")) {
            if (model == null || !model.isChatApplyReady()) return false;
            var ranges = morphParameterService.ranges(current.schemaVersion());
            var capabilities = noseEditService.capabilities(simulation, ranges);
            return capabilities != null
                    && control.storageCodes().stream()
                            .allMatch(capabilities.supported()::containsKey);
        }
        return contour.matches(model) && contour.codes().contains(control.code);
    }

    private ConsultCorrection.Target correctionTarget(
            Simulation simulation, ConsultCorrection.Selection correction) {
        SimulationService.checkVersion(simulation, correction.stateVersion());
        return correctionTargets(simulation, List.of(correction.control())).stream()
                .findFirst()
                .orElseThrow(() -> new BusinessException(ConsultErrorCode.NOT_APPLICABLE));
    }

    private List<ConsultCorrection.Target> correctionTargets(
            Simulation simulation, List<ConsultCorrection.Control> controls) {
        var history =
                morphChangeRepository.findBySimulationIdAndSeqLessThanEqualOrderBySeqDesc(
                        simulation.getId(), simulation.getCurrentSeq());
        var pending = new ArrayList<>(controls);
        var result = new ArrayList<ConsultCorrection.Target>();
        if (history.isEmpty()) return result;
        var after = codec.read(history.getFirst().getStateAfter());
        for (int index = 0; index + 1 < history.size() && !pending.isEmpty(); index++) {
            var change = history.get(index);
            var before = codec.read(history.get(index + 1).getStateAfter());
            var next = after;
            var changed =
                    pending.stream()
                            .filter(control -> ConsultCorrection.changed(control, before, next))
                            .toList();
            pending.removeAll(changed);
            if (!changed.isEmpty()
                    && change.getSource() == MorphChangeSource.CHAT
                    && change.getChangeRequestId() != null) {
                changeRequestRepository
                        .findByIdAndSimulationId(change.getChangeRequestId(), simulation.getId())
                        .filter(request -> request.getStatus() == ChangeRequestStatus.APPLIED)
                        .filter(request -> activeRequest(simulation, request))
                        .map(request -> json.readRequest(request.getRequestJson()))
                        .filter(
                                request ->
                                        request.modeSwitch() == null
                                                && request.correction() == null)
                        .ifPresent(
                                request ->
                                        changed.stream()
                                                .filter(
                                                        control ->
                                                                request.actions().stream()
                                                                        .anyMatch(
                                                                                action ->
                                                                                        control
                                                                                                        == ConsultCorrection
                                                                                                                .Control
                                                                                                                .FOLD
                                                                                                ? action.code()
                                                                                                        .startsWith(
                                                                                                                "eye.style_")
                                                                                                : control
                                                                                                        .code
                                                                                                        .equals(
                                                                                                                action
                                                                                                                        .code())))
                                                .forEach(
                                                        control ->
                                                                result.add(
                                                                        new ConsultCorrection
                                                                                .Target(
                                                                                control, before))));
            }
            after = before;
        }
        return result;
    }

    /** 되돌리기·앞으로 가기·초기화·더/덜. 문장이 정규식으로 고정돼 이름이 들어갈 수 없어 그대로 저장한다. */
    private SendMessageResponse runCommand(
            String userId,
            String simulationId,
            ConsultCommand command,
            String content,
            int preparedVersion,
            EyeEditService.Proof proof,
            WeightShapeEditGuard.Proof compositeProof,
            int conversation) {
        eyeEditService.lockProofModel(userId, proof);
        simulationService.lockCompositeProofModel(userId, compositeProof);
        Simulation simulation = simulationService.lockOwned(userId, simulationId);
        requireConversation(simulation.getConsultAfterSeq(), conversation);
        if (conversation > 0
                && command != ConsultCommand.UNDO
                && command != ConsultCommand.REDO
                && command != ConsultCommand.RESET
                && latestActiveMessage(simulation).isEmpty()) {
            return reply(
                    simulation,
                    content,
                    "어느 부위를 조절할까요? 직접 조절 탭에서 가능한 항목을 볼 수 있어요. 얼굴은 그대로예요.",
                    "REPLY",
                    null);
        }
        return switch (command) {
            case UNDO -> {
                SimulationService.checkVersion(simulation, preparedVersion);
                if (!simulationService.canUndo(simulation)) {
                    yield reply(simulation, content, "되돌릴 변경이 없어요.", "REPLY", null);
                }
                EditResultResponse r =
                        simulationService.undo(
                                userId, simulationId, preparedVersion, proof, compositeProof);
                yield reply(simulation, content, r.undoneSummary(), "UNDO", r);
            }
            case REDO -> {
                SimulationService.checkVersion(simulation, preparedVersion);
                if (!simulationService.canRedo(simulation)) {
                    yield reply(simulation, content, "앞으로 갈 변경이 없어요.", "REPLY", null);
                }
                EditResultResponse r =
                        simulationService.redo(
                                userId, simulationId, preparedVersion, proof, compositeProof);
                yield reply(simulation, content, r.redoneSummary(), "REDO", r);
            }
            case RESET -> {
                EditResultResponse r =
                        simulationService.reset(userId, simulationId, simulation.getStateVersion());
                yield reply(simulation, content, "처음 상태로 돌렸어요. 되돌리기로 다시 복구할 수 있어요.", "RESET", r);
            }
            case MORE, LESS -> {
                Optional<StoredRequest> previous = followUpTarget(simulation);
                if (previous.isEmpty()) {
                    yield reply(
                            simulation,
                            content,
                            "먼저 바꾸고 싶은 부분을 말씀해 주세요. 얼굴은 바꾸지 않았어요.",
                            "REPLY",
                            null);
                }
                if (previous.get().actions().stream()
                        .anyMatch(a -> a.code().startsWith("eye.style_"))) {
                    yield reply(
                            simulation,
                            content,
                            "쌍꺼풀 모양은 더·덜로 조절하지 않아요. 인라인·인아웃·아웃라인 중 원하는 모양을 다시 말씀해 주세요.",
                            "REPLY",
                            null);
                }
                if (previous.get().actions().stream().anyMatch(a -> a.target() != null)) {
                    yield reply(
                            simulation,
                            content,
                            "바꿀 방향이나 원하는 슬라이더 값을 다시 말씀해 주세요. 얼굴은 그대로예요.",
                            "REPLY",
                            null);
                }
                List<EditAction> actions =
                        ConsultEdits.adjust(
                                previous.get().actions(), command == ConsultCommand.MORE);
                yield saveTurn(
                        simulation,
                        content,
                        false,
                        "",
                        "EDIT",
                        false,
                        List.of(),
                        false,
                        actions,
                        List.of(),
                        null,
                        null);
            }
            case REDUCE, NARROW, WIDEN -> {
                Optional<StoredRequest> previous = followUpTarget(simulation);
                String code =
                        previous.filter(r -> r.actions().size() == 1)
                                .map(r -> r.actions().getFirst().code())
                                .orElse("");
                boolean contour =
                        ConsultEdits.CHAT_CONTOUR_CODES.contains(code) && !WEIGHT_CODE.equals(code);
                boolean supported =
                        command == ConsultCommand.REDUCE
                                ? contour || "nose.alar_width".equals(code)
                                : "nose.alar_width".equals(code);
                if (!supported) {
                    yield reply(
                            simulation,
                            content,
                            "어느 부위를 더 조절할까요? 직접 조절 탭에서 가능한 항목을 볼 수 있어요. 얼굴은 그대로예요.",
                            "REPLY",
                            null);
                }
                List<EditAction> actions =
                        List.of(
                                new EditAction(
                                        code,
                                        "both",
                                        command == ConsultCommand.WIDEN ? 1 : -1,
                                        "small"));
                yield saveTurn(
                        simulation,
                        content,
                        false,
                        "",
                        "EDIT",
                        false,
                        List.of(),
                        false,
                        actions,
                        List.of(),
                        null,
                        null);
            }
            case BOTH -> bothOptions(simulation, content);
        };
    }

    private SendMessageResponse bothOptions(Simulation simulation, String content) {
        var latest = messageRepository.findTop10BySimulationIdOrderBySeqDesc(simulation.getId());
        if (latest.size() >= 2
                && latest.getFirst().isNeedsClarification()
                && latest.get(1).getRole() == ConsultRole.USER) {
            var options = json.readOptions(latest.getFirst().getOptions());
            if (options.size() == 2
                    && options.stream()
                            .allMatch(
                                    o ->
                                            o.stateVersion() == simulation.getStateVersion()
                                                    && o.guideCode() != null
                                                    && o.guideCode().startsWith("contour.")
                                                    && !WEIGHT_CODE.equals(o.guideCode()))) {
                String previous = latest.get(1).getContent();
                int direction = SpringConsultClient.contourDirection("", previous);
                if (direction != 0
                        && previous.matches(
                                "턱(?:도|을|은|은요)?\\s*(?:(?:조금|많이|살짝|좀)\\s*)?(?:줄여|작게\\s*해)\\s*(?:줘|주세요)?[.!\\s]*")) {
                    var actions =
                            options.stream()
                                    .map(
                                            o ->
                                                    new EditAction(
                                                            o.guideCode(),
                                                            "both",
                                                            direction,
                                                            SpringConsultClient.contourStrength(
                                                                    previous)))
                                    .toList();
                    return saveTurn(
                            simulation,
                            content,
                            false,
                            "",
                            "EDIT",
                            false,
                            List.of(),
                            false,
                            actions,
                            List.of(),
                            null,
                            null);
                }
                return reply(
                        simulation, content, "두 항목을 각각 어떻게 바꿀까요? 얼굴은 바꾸지 않았어요.", "REPLY", null);
            }
        }
        return reply(
                simulation, content, "함께 바꾸고 싶은 두 항목과 방향을 말씀해 주세요. 얼굴은 바꾸지 않았어요.", "REPLY", null);
    }

    private SendMessageResponse reply(
            Simulation simulation,
            String userContent,
            String answer,
            String intent,
            EditResultResponse morphResult) {
        return saveTurn(
                simulation,
                userContent,
                false,
                answer,
                intent,
                false,
                List.of(),
                false,
                List.of(),
                List.of(),
                null,
                morphResult);
    }

    /** 사용자·도우미 메시지(seq n+1·n+2)와, 편집 후보가 있으면 변경 요청을 저장하고 시안 활동 시각을 올린다. 잠근 시안에서만 부른다. */
    private SendMessageResponse saveTurn(
            Simulation simulation,
            String userContent,
            boolean masked,
            String answer,
            String intent,
            boolean needsClarification,
            List<StoredOption> options,
            boolean filtered,
            List<EditAction> actions,
            List<SkippedClause> skipped,
            String recommendedSliderCode,
            EditResultResponse morphResult) {
        return saveTurn(
                simulation,
                userContent,
                masked,
                answer,
                intent,
                needsClarification,
                options,
                filtered,
                actions,
                skipped,
                recommendedSliderCode,
                morphResult,
                null);
    }

    private SendMessageResponse saveTurn(
            Simulation simulation,
            String userContent,
            boolean masked,
            String answer,
            String intent,
            boolean needsClarification,
            List<StoredOption> options,
            boolean filtered,
            List<EditAction> actions,
            List<SkippedClause> skipped,
            String recommendedSliderCode,
            EditResultResponse morphResult,
            ModeSwitch modeSwitch) {
        return saveTurn(
                simulation,
                userContent,
                masked,
                answer,
                intent,
                needsClarification,
                options,
                filtered,
                actions,
                skipped,
                recommendedSliderCode,
                morphResult,
                modeSwitch,
                null,
                null);
    }

    private SendMessageResponse saveTurn(
            Simulation simulation,
            String userContent,
            boolean masked,
            String answer,
            String intent,
            boolean needsClarification,
            List<StoredOption> options,
            boolean filtered,
            List<EditAction> actions,
            List<SkippedClause> skipped,
            String recommendedSliderCode,
            EditResultResponse morphResult,
            ModeSwitch modeSwitch,
            ConsultCorrection.Selection correction,
            Integer guidanceStateVersion) {
        if (!actions.isEmpty()) {
            MorphState state = transitionBase(simulation, modeSwitch);
            boolean weightRequested = actions.stream().anyMatch(a -> WEIGHT_CODE.equals(a.code()));
            boolean faceRequested = actions.stream().anyMatch(a -> !WEIGHT_CODE.equals(a.code()));
            if ((weightRequested && (faceRequested || WeightShapeEditGuard.hasFaceEdits(state)))
                    || (faceRequested && weightActive(state))) {
                return saveTurn(
                        simulation,
                        userContent,
                        masked,
                        "체중 변화는 눈·코·윤곽과 따로 조절할 수 있어요. 직접 조절에서 원하는 모드로 전환해 주세요. 얼굴은 바꾸지 않았어요.",
                        "REPLY",
                        false,
                        List.of(),
                        filtered,
                        List.of(),
                        List.of(),
                        null,
                        null);
            }
        }
        String simulationId = simulation.getId();
        int seq = Math.max(messageRepository.maxSeq(simulationId), simulation.getConsultAfterSeq());
        ConsultMessage user =
                messageRepository.save(
                        ConsultMessage.user(simulationId, seq + 1, userContent, masked));
        ConsultMessage assistant =
                messageRepository.save(
                        ConsultMessage.assistant(
                                simulationId,
                                seq + 2,
                                answer,
                                intent,
                                needsClarification,
                                options.isEmpty() ? null : json.write(options),
                                filtered));

        ChangeRequestView view = null;
        if (!actions.isEmpty()) {
            String requestId = UUID.randomUUID().toString();
            StoredRequest stored =
                    new StoredRequest(
                            requestId,
                            SCHEMA_V2,
                            actions,
                            skipped,
                            userContent,
                            null,
                            modeSwitch,
                            correction,
                            guidanceStateVersion);
            changeRequestRepository.save(
                    ChangeRequest.complete(
                            requestId,
                            simulationId,
                            assistant.getId(),
                            ConsultEdits.part(actions),
                            json.write(stored),
                            SCHEMA_V2));
            view = toView(stored, ChangeRequestStatus.COMPLETE);
        }
        simulation.markConversation();

        return new SendMessageResponse(
                new SendMessageResponse.UserMessage(user.getId(), user.getContent(), masked),
                new SendMessageResponse.AssistantMessage(
                        assistant.getId(), SENDER, answer, intent, filtered),
                view,
                needsClarification,
                needsClarification ? optionViews(options) : List.of(),
                recommendedSliderCode,
                morphResult,
                profileSection(options));
    }

    // ---- 공통 ----

    private Simulation ownedReadable(String userId, String simulationId) {
        return simulationRepository
                .findByIdAndUserIdAndDeletedAtIsNull(simulationId, userId)
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
    }

    private Optional<StoredRequest> lastApplied(Simulation simulation) {
        return changeRequestRepository
                .findFirstBySimulationIdAndStatusOrderByAppliedAtDesc(
                        simulation.getId(), ChangeRequestStatus.APPLIED)
                .filter(r -> activeRequest(simulation, r))
                .map(r -> json.readRequest(r.getRequestJson()));
    }

    private Optional<ConsultMessage> latestActiveMessage(Simulation simulation) {
        return messageRepository
                .findFirstBySimulationIdOrderBySeqDesc(simulation.getId())
                .filter(message -> message.getSeq() > simulation.getConsultAfterSeq());
    }

    private Optional<StoredRequest> followUpTarget(Simulation simulation) {
        String simulationId = simulation.getId();
        // 거절이나 되묻기 뒤에는 현재 편집 이력만 보고 새 요청의 대상을 추측하지 않는다.
        Optional<ConsultMessage> latest = latestActiveMessage(simulation);
        if (latest.isEmpty()) return Optional.empty();
        ConsultMessage last = latest.get();
        return simulationService
                .currentChatRequestId(simulation)
                .flatMap(id -> changeRequestRepository.findByIdAndSimulationId(id, simulationId))
                .filter(r -> activeRequest(simulation, r))
                .filter(
                        request ->
                                request.getConsultMessageId().equals(last.getId())
                                        || "UNDO".equals(last.getIntent())
                                        || "REDO".equals(last.getIntent()))
                .map(request -> json.readRequest(request.getRequestJson()))
                .filter(request -> request.applyResult() != null && request.correction() == null);
    }

    private ConsultMessageListResponse.Item toItem(ConsultMessage m, ChangeRequest request) {
        boolean assistant = m.getRole() == ConsultRole.ASSISTANT;
        StoredRequest stored = request == null ? null : json.readRequest(request.getRequestJson());
        var options = json.readOptions(m.getOptions());
        return new ConsultMessageListResponse.Item(
                m.getId(),
                m.getRole().name(),
                assistant ? SENDER : null,
                m.getContent(),
                m.getIntent(),
                m.isNeedsClarification(),
                m.isNeedsClarification() ? optionViews(options) : List.of(),
                options.stream()
                        .filter(option -> ADVICE_COMPARISON.equals(option.id()))
                        .map(StoredOption::guideCode)
                        .filter(Objects::nonNull)
                        .findFirst()
                        .orElse(null),
                stored == null ? null : toView(stored, request.getStatus()),
                stored == null ? null : stored.applyResult(),
                m.getCreatedAt(),
                profileSection(options));
    }

    private static boolean inAnalysisTopic(String topic, String candidate) {
        if (topic == null || "overall".equals(topic)) return true;
        return switch (topic) {
            case "eyes" -> "eyeInner".equals(candidate);
            case "lower" -> Set.of("jawAngle", "chinLength").contains(candidate);
            case "side" -> Set.of("chinProjection", "projection").contains(candidate);
            default -> false;
        };
    }

    private static boolean validProfileSection(String section) {
        String control = "(?:chinProjection|jawAngle|chinLength|projection|eyeInner)";
        String controls = "(?:none|" + control + "(?:," + control + "){0,4})";
        return section != null
                && (SpringConsultClient.PROFILE_SECTIONS.contains(section)
                        || section.matches("next:" + controls + "(:fold)?")
                        || section.matches(
                                "analysis:(?:overall|eyes|lips|lower|side):" + controls));
    }

    private static String profileSection(List<StoredOption> options) {
        return options.stream()
                .map(StoredOption::id)
                .filter(id -> id.startsWith("profile:"))
                .map(id -> id.substring("profile:".length()))
                .filter(section -> validProfileSection(section.split(":measured:", 2)[0]))
                .findFirst()
                .orElse(null);
    }

    private static List<SendMessageResponse.Option> optionViews(List<StoredOption> options) {
        return options.stream()
                .map(o -> new SendMessageResponse.Option(o.id(), o.label()))
                .toList();
    }

    private static ChangeRequestView toView(StoredRequest stored, ChangeRequestStatus status) {
        return new ChangeRequestView(
                stored.requestId(),
                status.name(),
                stored.schemaVersion(),
                stored.actions(),
                nullToEmpty(stored.skipped()));
    }

    private static String truncate(String content) {
        return content.length() <= MAX_RECENT_CONTENT
                ? content
                : content.substring(content.length() - MAX_RECENT_CONTENT);
    }

    private static <T> List<T> nullToEmpty(List<T> list) {
        return list == null ? List.of() : list;
    }
}
