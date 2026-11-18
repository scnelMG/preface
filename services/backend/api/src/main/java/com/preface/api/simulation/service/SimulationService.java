package com.preface.api.simulation.service;

import com.preface.api.simulation.dto.EditResultResponse;
import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.EyeStateUpdateRequest;
import com.preface.api.simulation.dto.ModelEditRanges;
import com.preface.api.simulation.dto.MorphState;
import com.preface.api.simulation.dto.MorphStateUpdateRequest;
import com.preface.api.simulation.dto.NoseCapabilities;
import com.preface.api.simulation.dto.PointStroke;
import com.preface.api.simulation.dto.PointStrokesUpdateRequest;
import com.preface.api.simulation.dto.SimulationResponse;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.EditErrorCode;
import com.preface.common.error.HistoryErrorCode;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.MorphChange;
import com.preface.common.simulation.entity.MorphChangeSource;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.MorphChangeRepository;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 시안 생성·조회와 편집(API-EDIT-02·03·04·06·07·08).
 *
 * <p>이력 모델(ERD 설명 "undo·redo = morph_change 스택"): 변경 하나 = {@code morph_change} 한 행(변경 후 가중치 전체),
 * 시안의 {@code current_seq}가 지금 상태의 행을 가리킨다. seq는 0(INIT)부터 빈틈없이 1씩 오른다.
 *
 * <ul>
 *   <li>새 변경(슬라이더·reset): 포인터 뒤(redo) 행을 지우고 {@code current_seq + 1} 행을 추가한다. 되돌릴 수 있는 단계가 {@link
 *       #MAX_UNDO_STEPS}를 넘으면 가장 오래된 행부터 지운다.
 *   <li>undo·redo: 행을 지우지 않고 포인터만 1 옮긴다.
 * </ul>
 *
 * <p>모든 편집은 시안 행을 잠그고(SELECT … FOR UPDATE) {@code stateVersion}을 비교한다. 다르면 EDIT_002.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SimulationService {

    /** 시안별 되돌리기 최대 단계 [확정, FN-EDIT-04]. */
    static final int MAX_UNDO_STEPS = 50;

    private static final ZoneId TITLE_ZONE = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter TITLE_DATE = DateTimeFormatter.ofPattern("yyyy.MM.dd");
    private static final String RESET_SUMMARY = "초기화";
    private static final String GENERIC_SUMMARY = "직전 변경";

    private final SimulationRepository simulationRepository;
    private final MorphChangeRepository morphChangeRepository;
    private final MorphParameterService morphParameterService;
    private final NoseEditService noseEditService;
    private final EyeEditService eyeEditService;
    private final WeightShapeEditGuard weightShapeEditGuard;
    private final WeightContourEditService weightContourEditService;
    private final WeightShapeModelApprovalService contourApproval;
    private final FaceModelRepository faceModels;
    private final MorphStateCodec codec;
    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    /** API-EDIT-02. 빈 시안과 seq 0(INIT) 이력을 만든다. */
    @Transactional
    public SimulationResponse create(String userId, String faceModelId) {
        String schemaVersion = lockReadyFaceModel(userId, faceModelId);
        String base = LocalDate.now(clock.withZone(TITLE_ZONE)).format(TITLE_DATE) + " 시안";
        String title =
                nextTitle(base, simulationRepository.findTitlesStartingWith(faceModelId, base));
        String state = codec.write(new MorphState(schemaVersion, new TreeMap<>()));

        Simulation simulation =
                simulationRepository.saveAndFlush(
                        Simulation.create(userId, faceModelId, title, state));
        morphChangeRepository.save(
                MorphChange.record(
                        simulation.getId(), 0, MorphChangeSource.INIT, null, state, false, null));
        return toResponse(simulation, null);
    }

    /** API-EDIT-03. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public SimulationResponse detail(String userId, String simulationId) {
        Simulation simulation =
                simulationRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(simulationId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        return toResponse(
                simulation,
                faceModels
                        .findById(simulation.getFaceModelId())
                        .map(contourApproval::supportedContourCodes)
                        .orElseGet(Set::of));
    }

    /** 생성 모델의 얼굴형 양방향 자산·승인 결속이 현재도 유효한지 확인한다. */
    public boolean weightShapeSupported(String faceModelId) {
        return weightShapeEditGuard.supported(faceModelId);
    }

    /** 상담 명령의 선행 모델 잠금도 시안 잠금보다 먼저 잡는다. */
    public void lockCompositeProofModel(String userId, WeightShapeEditGuard.Proof proof) {
        weightShapeEditGuard.lockProofModel(userId, proof);
    }

    /** API-EDIT-04. 놓을 때 1회 호출 = undo 1단계. */
    @Transactional
    public EditResultResponse updateMorphState(
            String userId,
            String simulationId,
            MorphStateUpdateRequest request,
            EyeEditService.Proof proof,
            PreparedMorph prepared) {
        eyeEditService.lockProofModel(userId, proof);
        weightShapeEditGuard.lockProofModel(userId, prepared.composite());
        ContourProof contour = prepared.contour();
        if (contour != null
                && faceModels
                        .findOwnedForUpdate(contour.modelId(), userId)
                        .filter(contour::matches)
                        .isEmpty()) {
            throw new BusinessException(EditErrorCode.STATE_VERSION_CONFLICT);
        }
        Simulation simulation = lockForEdit(userId, simulationId, request.stateVersion());
        if (contour != null && !contour.modelId().equals(simulation.getFaceModelId())) {
            throw new BusinessException(EditErrorCode.STATE_VERSION_CONFLICT);
        }
        MorphState current = codec.read(simulation.getMorphState());
        validatePreservedEyes(simulation, current.eyeEdit(), proof);
        Map<String, MorphRange> ranges = morphParameterService.ranges(current.schemaVersion());
        List<MorphEdits.Requested> requested =
                request.changes().stream()
                        .map(c -> new MorphEdits.Requested(c.code(), c.value()))
                        .toList();

        MorphEdits.Applied candidate = MorphEdits.apply(current.weights(), requested, ranges);
        weightShapeEditGuard.requireSafe(
                simulation,
                WeightShapeEditGuard.requireExclusive(
                        new MorphState(
                                current.schemaVersion(),
                                candidate.weights(),
                                current.pointStrokes(),
                                current.eyeEdit())),
                prepared.composite());
        MorphEdits.Applied applied =
                noseEditService.validate(
                        simulation,
                        current.weights(),
                        candidate,
                        ranges,
                        current.pointStrokes(),
                        false);
        if (applied.changes().stream().allMatch(c -> c.from() == c.to())) {
            return result(simulation, applied.clamped(), null, null);
        }
        MorphState next =
                new MorphState(
                        current.schemaVersion(),
                        applied.weights(),
                        current.pointStrokes(),
                        current.eyeEdit());
        record(
                simulation,
                MorphChangeSource.SLIDER,
                codec.writeDelta(applied.changes()),
                next,
                applied.clamped(),
                MorphEdits.summary(applied.changes(), ranges),
                prepared.composite());
        return result(simulation, applied.clamped(), null, null);
    }

    /** 코 편집이 현재 눈 상태를 새 이력에 복사하기 전에 행 잠금 밖에서 검사한다. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public EyeEditService.Proof preparePreservedEyeState(
            String userId, String simulationId, int stateVersion) {
        Simulation simulation = ownedReadable(userId, simulationId);
        checkVersion(simulation, stateVersion);
        return eyeEditService.preparePreserved(
                simulation, codec.read(simulation.getMorphState()).eyeEdit());
    }

    public record PreparedMorph(WeightShapeEditGuard.Proof composite, ContourProof contour) {}

    public record ContourProof(
            String modelId, String meshKey, String noseApproval, String weightApproval) {
        boolean matches(com.preface.common.facemodel.entity.FaceModel model) {
            return !model.isDeleted()
                    && Objects.equals(meshKey, model.getMeshObjectKey())
                    && Objects.equals(noseApproval, model.getApprovedNoseCapabilities())
                    && Objects.equals(weightApproval, model.getApprovedWeightShape());
        }
    }

    /** 윤곽 타깃과 체중·윤곽 최종 피부를 시안 행 잠금 밖에서 검사한다. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public PreparedMorph prepareCompositeMorphState(
            String userId, String simulationId, MorphStateUpdateRequest request) {
        Simulation simulation = ownedReadable(userId, simulationId);
        checkVersion(simulation, request.stateVersion());
        MorphState current = codec.read(simulation.getMorphState());
        MorphEdits.Applied candidate =
                MorphEdits.apply(
                        current.weights(),
                        request.changes().stream()
                                .map(c -> new MorphEdits.Requested(c.code(), c.value()))
                                .toList(),
                        morphParameterService.ranges(current.schemaVersion()));
        Set<String> changedContour = new HashSet<>();
        for (var change : candidate.changes()) {
            if (change.to() != 0
                    && change.from() != change.to()
                    && WeightShapeModelApprovalService.CONTOUR_CODES.contains(change.code())) {
                changedContour.add(change.code());
            }
        }
        ContourProof contour = null;
        if (!changedContour.isEmpty()) {
            var model =
                    faceModels
                            .findById(simulation.getFaceModelId())
                            .orElseThrow(
                                    () -> new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE));
            if (!contourApproval.supportedContourCodes(model).containsAll(changedContour)) {
                throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
            }
            contour =
                    new ContourProof(
                            model.getId(),
                            model.getMeshObjectKey(),
                            model.getApprovedNoseCapabilities(),
                            model.getApprovedWeightShape());
        }
        return new PreparedMorph(
                weightContourEditService.prepare(
                        simulation,
                        WeightShapeEditGuard.requireExclusive(
                                new MorphState(
                                        current.schemaVersion(),
                                        candidate.weights(),
                                        current.pointStrokes(),
                                        current.eyeEdit()))),
                contour);
    }

    /** 행 잠금 밖에서 눈 전체 형상을 검사한다. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public EyeEditService.Proof prepareEyeState(
            String userId, String simulationId, EyeStateUpdateRequest request) {
        Simulation simulation = ownedReadable(userId, simulationId);
        checkVersion(simulation, request.stateVersion());
        return eyeEditService.prepare(simulation, request.eyeEdit());
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public WeightShapeEditGuard.Proof prepareCompositeEyeState(
            String userId, String simulationId, EyeStateUpdateRequest request) {
        Simulation simulation = ownedReadable(userId, simulationId);
        checkVersion(simulation, request.stateVersion());
        MorphState current = codec.read(simulation.getMorphState());
        return weightContourEditService.prepare(
                simulation,
                WeightShapeEditGuard.requireExclusive(
                        new MorphState(
                                current.schemaVersion(),
                                current.weights(),
                                current.pointStrokes(),
                                request.eyeEdit())));
    }

    /** 눈 카드의 전체 상태를 코와 같은 stateVersion·이력 스택에 한 단계로 저장한다. */
    @Transactional
    public EditResultResponse updateEyeState(
            String userId,
            String simulationId,
            EyeStateUpdateRequest request,
            EyeEditService.Proof proof,
            WeightShapeEditGuard.Proof compositeProof) {
        eyeEditService.lockProofModel(userId, proof);
        weightShapeEditGuard.lockProofModel(userId, compositeProof);
        Simulation simulation = lockForEdit(userId, simulationId, request.stateVersion());
        MorphState current = codec.read(simulation.getMorphState());
        EyeEditState nextEyes =
                eyeEditService.validatePrepared(simulation, request.eyeEdit(), proof);
        if (Objects.equals(
                current.eyeEdit() == null ? EyeEditState.initial() : current.eyeEdit(), nextEyes)) {
            return result(simulation, false, null, null);
        }
        record(
                simulation,
                MorphChangeSource.SLIDER,
                null,
                new MorphState(
                        current.schemaVersion(),
                        current.weights(),
                        current.pointStrokes(),
                        nextEyes),
                false,
                "눈 조절 변경",
                compositeProof);
        return result(simulation, false, null, null);
    }

    /** 코 피부 점을 움직인 한 번의 드래그를 이력 한 단계로 저장한다. */
    @Transactional
    public EditResultResponse updatePointStrokes(
            String userId,
            String simulationId,
            PointStrokesUpdateRequest request,
            EyeEditService.Proof proof) {
        eyeEditService.lockProofModel(userId, proof);
        Simulation simulation = lockForEdit(userId, simulationId, request.stateVersion());
        MorphState current = codec.read(simulation.getMorphState());
        validatePreservedEyes(simulation, current.eyeEdit(), proof);
        List<PointStroke> points = request.pointStrokes();
        if (points.size() != current.pointStrokes().size() + 1
                || !points.subList(0, points.size() - 1).equals(current.pointStrokes())) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        Map<String, MorphRange> ranges = morphParameterService.ranges(current.schemaVersion());
        List<PointStroke> actual =
                noseEditService.validatePoints(
                        simulation, current.weights(), current.pointStrokes(), points, ranges);
        record(
                simulation,
                MorphChangeSource.POINT,
                codec.writePointStrokes(actual.subList(actual.size() - 1, actual.size())),
                new MorphState(
                        current.schemaVersion(), current.weights(), actual, current.eyeEdit()),
                false,
                "코 제어점 이동");
        return result(simulation, false, null, null);
    }

    /** API-EDIT-07. 코·윤곽 가중치를 비운다(편집할 수 없는 옛 값은 남긴다). reset도 이력 1건(source=RESET)이라 undo로 복구된다. */
    @Transactional
    public EditResultResponse reset(String userId, String simulationId, int stateVersion) {
        Simulation simulation = lockForEdit(userId, simulationId, stateVersion);
        MorphState current = codec.read(simulation.getMorphState());
        record(
                simulation,
                MorphChangeSource.RESET,
                null,
                originalMorphState(current),
                false,
                RESET_SUMMARY);
        return result(simulation, null, null, null);
    }

    public static MorphState originalMorphState(MorphState current) {
        Map<String, Double> retained = new TreeMap<>(current.weights());
        retained.keySet().removeIf(MorphEdits::isEditable);
        return new MorphState(current.schemaVersion(), retained, List.of(), null);
    }

    /** API-EDIT-06. */
    @Transactional
    public EditResultResponse undo(
            String userId,
            String simulationId,
            int stateVersion,
            EyeEditService.Proof proof,
            WeightShapeEditGuard.Proof compositeProof) {
        eyeEditService.lockProofModel(userId, proof);
        weightShapeEditGuard.lockProofModel(userId, compositeProof);
        Simulation simulation = lockForEdit(userId, simulationId, stateVersion);
        int seq = simulation.getCurrentSeq();
        MorphChange target =
                morphChangeRepository
                        .findBySimulationIdAndSeq(simulation.getId(), seq - 1)
                        .orElseThrow(() -> new BusinessException(EditErrorCode.NOTHING_TO_UNDO));
        String undone =
                morphChangeRepository
                        .findBySimulationIdAndSeq(simulation.getId(), seq)
                        .map(
                                change ->
                                        summaryOf(
                                                change,
                                                codec.read(simulation.getMorphState()),
                                                codec.read(target.getStateAfter())))
                        .orElse(GENERIC_SUMMARY);
        ensureSupportedTransition(simulation, target.getStateAfter(), proof, compositeProof);
        simulation.moveTo(target.getStateAfter(), target.getSeq());
        return result(simulation, null, MorphEdits.undoneSummary(undone), null);
    }

    /** API-EDIT-08. */
    @Transactional
    public EditResultResponse redo(
            String userId,
            String simulationId,
            int stateVersion,
            EyeEditService.Proof proof,
            WeightShapeEditGuard.Proof compositeProof) {
        eyeEditService.lockProofModel(userId, proof);
        weightShapeEditGuard.lockProofModel(userId, compositeProof);
        Simulation simulation = lockForEdit(userId, simulationId, stateVersion);
        MorphChange target =
                morphChangeRepository
                        .findBySimulationIdAndSeq(
                                simulation.getId(), simulation.getCurrentSeq() + 1)
                        .orElseThrow(() -> new BusinessException(EditErrorCode.NOTHING_TO_REDO));
        ensureSupportedTransition(simulation, target.getStateAfter(), proof, compositeProof);
        String redone =
                summaryOf(
                        target,
                        codec.read(simulation.getMorphState()),
                        codec.read(target.getStateAfter()));
        simulation.moveTo(target.getStateAfter(), target.getSeq());
        return result(simulation, null, null, MorphEdits.redoneSummary(redone));
    }

    /** 같은 3D에서 이름이 겹치면 " 2", " 3" …을 붙인다(API 명세서 "편집 세션 모델 — 이름"). */
    static String nextTitle(String base, Collection<String> taken) {
        Set<String> used = new HashSet<>(taken);
        if (!used.contains(base)) {
            return base;
        }
        int n = 2;
        while (used.contains(base + " " + n)) {
            n++;
        }
        return base + " " + n;
    }

    /**
     * 시안을 만들 수 있는 3D인지 확인하고 그 행을 잠근다(같은 3D에 동시에 만들 때 이름 번호가 겹치지 않게). face_model 엔티티는 복원 기능 스토리에서
     * 만들어서 여기서는 SQL로 읽는다.
     *
     * @return 그 3D의 morph 스키마 버전
     */
    private String lockReadyFaceModel(String userId, String faceModelId) {
        List<Map<String, Object>> rows =
                jdbcTemplate.queryForList(
                        "select fm.morph_schema_version, fm.deleted_at, j.status"
                                + " from face_model fm"
                                + " join reconstruction_job j on j.id = fm.reconstruction_job_id"
                                + " where fm.id = ? and fm.user_id = ? for update",
                        faceModelId,
                        userId);
        if (rows.isEmpty()) {
            throw new BusinessException(CommonErrorCode.NOT_FOUND);
        }
        Map<String, Object> row = rows.getFirst();
        if (row.get("deleted_at") != null) {
            throw new BusinessException(HistoryErrorCode.BEING_DELETED);
        }
        if (!"SUCCEEDED".equals(row.get("status"))) {
            throw new BusinessException(EditErrorCode.FACE_MODEL_NOT_READY);
        }
        return (String) row.get("morph_schema_version");
    }

    /**
     * 상담 반영(API-EDIT-05). 호출한 쪽이 {@link #lockOwned}·{@link #checkVersion}으로 잠그고 확인한 시안에 슬라이더와 같은 규칙
     * (redo 삭제·50단계·포인터 이동·버전 증가)으로 CHAT 이력 1건을 남긴다.
     */
    @Transactional
    public EditResultResponse recordChat(
            Simulation simulation,
            MorphEdits.Applied applied,
            String changeRequestId,
            String summary) {
        return recordChatCombined(
                simulation, null, applied, null, null, null, changeRequestId, summary);
    }

    /** 상담의 눈·코 변경을 같은 seq와 stateVersion으로 기록한다. null 쪽은 기존 상태를 유지한다. */
    @Transactional
    public EditResultResponse recordChatCombined(
            Simulation simulation,
            MorphState transitionBase,
            MorphEdits.Applied applied,
            EyeEditState nextEyes,
            EyeEditService.Proof proof,
            WeightShapeEditGuard.Proof compositeProof,
            String changeRequestId,
            String summary) {
        MorphState current =
                transitionBase == null ? codec.read(simulation.getMorphState()) : transitionBase;
        EyeEditState validatedEyes =
                nextEyes == null
                        ? validatePreservedEyes(simulation, current.eyeEdit(), proof)
                        : eyeEditService.validatePrepared(simulation, nextEyes, proof);
        record(
                simulation,
                MorphChangeSource.CHAT,
                changeRequestId,
                applied == null ? null : codec.writeDelta(applied.changes()),
                new MorphState(
                        current.schemaVersion(),
                        applied == null ? current.weights() : applied.weights(),
                        current.pointStrokes(),
                        validatedEyes),
                applied != null && applied.clamped(),
                summary,
                compositeProof);
        return result(simulation, applied != null && applied.clamped(), null, null);
    }

    /** 본인 시안을 편집용으로 잠근다(SELECT … FOR UPDATE). 없거나 남의 것이면 COMMON_002. */
    @Transactional
    public Simulation lockOwned(String userId, String simulationId) {
        return simulationRepository
                .findOwnedForUpdate(simulationId, userId)
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
    }

    /** 낙관적 잠금 비교. 다르면 EDIT_002. */
    public static void checkVersion(Simulation simulation, int stateVersion) {
        if (!simulation.isStateVersion(stateVersion)) {
            throw new BusinessException(
                    EditErrorCode.STATE_VERSION_CONFLICT,
                    "stateVersion " + stateVersion + " != " + simulation.getStateVersion());
        }
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public EyeEditService.Proof prepareHistoryRestore(
            String userId, String simulationId, int stateVersion, int step) {
        Simulation simulation = ownedReadable(userId, simulationId);
        checkVersion(simulation, stateVersion);
        int targetSeq = simulation.getCurrentSeq() + step;
        MorphChange target =
                morphChangeRepository
                        .findBySimulationIdAndSeq(simulationId, targetSeq)
                        .orElseThrow(
                                () ->
                                        new BusinessException(
                                                step < 0
                                                        ? EditErrorCode.NOTHING_TO_UNDO
                                                        : EditErrorCode.NOTHING_TO_REDO));
        EyeEditState eyes = codec.read(target.getStateAfter()).eyeEdit();
        return eyes == null ? null : eyeEditService.prepare(simulation, eyes);
    }

    /** undo·redo의 대상이 복합 상태면 같은 최종 피부를 잠금 밖에서 검사한다. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public WeightShapeEditGuard.Proof prepareCompositeHistoryRestore(
            String userId, String simulationId, int stateVersion, int step) {
        Simulation simulation = ownedReadable(userId, simulationId);
        checkVersion(simulation, stateVersion);
        return morphChangeRepository
                .findBySimulationIdAndSeq(simulationId, simulation.getCurrentSeq() + step)
                .map(
                        change ->
                                weightContourEditService.prepare(
                                        simulation, codec.read(change.getStateAfter())))
                .orElse(null);
    }

    private void ensureSupportedTransition(
            Simulation simulation,
            String afterJson,
            EyeEditService.Proof proof,
            WeightShapeEditGuard.Proof compositeProof) {
        MorphState before = codec.read(simulation.getMorphState());
        MorphState after = codec.read(afterJson);
        if (!MorphEdits.preservesLocked(before.weights(), after.weights())) {
            throw new BusinessException(
                    EditErrorCode.UNKNOWN_MORPH_CODE, "locked part history change");
        }
        weightShapeEditGuard.requireSafe(simulation, after, compositeProof);
        if (after.eyeEdit() != null)
            eyeEditService.validatePrepared(simulation, after.eyeEdit(), proof);
        else if (proof != null) throw new BusinessException(EditErrorCode.STATE_VERSION_CONFLICT);
    }

    private EyeEditState validatePreservedEyes(
            Simulation simulation, EyeEditState state, EyeEditService.Proof proof) {
        if (state != null && !EyeEditState.initial().equals(state))
            return eyeEditService.validatePrepared(simulation, state, proof);
        if (proof != null) throw new BusinessException(EditErrorCode.STATE_VERSION_CONFLICT);
        return state;
    }

    private Simulation lockForEdit(String userId, String simulationId, int stateVersion) {
        Simulation simulation = lockOwned(userId, simulationId);
        checkVersion(simulation, stateVersion);
        return simulation;
    }

    private Simulation ownedReadable(String userId, String simulationId) {
        return simulationRepository
                .findByIdAndUserIdAndDeletedAtIsNull(simulationId, userId)
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
    }

    private void record(
            Simulation simulation,
            MorphChangeSource source,
            String delta,
            MorphState next,
            boolean clamped,
            String summary) {
        record(simulation, source, null, delta, next, clamped, summary, null);
    }

    private void record(
            Simulation simulation,
            MorphChangeSource source,
            String delta,
            MorphState next,
            boolean clamped,
            String summary,
            WeightShapeEditGuard.Proof compositeProof) {
        record(simulation, source, null, delta, next, clamped, summary, compositeProof);
    }

    /** 새 변경 기록: redo 이력 삭제 → 다음 seq 추가 → 상한 넘는 옛 이력 삭제 → 포인터 이동. */
    private void record(
            Simulation simulation,
            MorphChangeSource source,
            String changeRequestId,
            String delta,
            MorphState next,
            boolean clamped,
            String summary) {
        record(simulation, source, changeRequestId, delta, next, clamped, summary, null);
    }

    private void record(
            Simulation simulation,
            MorphChangeSource source,
            String changeRequestId,
            String delta,
            MorphState next,
            boolean clamped,
            String summary,
            WeightShapeEditGuard.Proof compositeProof) {
        weightShapeEditGuard.requireSafe(
                simulation, WeightShapeEditGuard.requireExclusive(next), compositeProof);
        int nextSeq = simulation.getCurrentSeq() + 1;
        String state = codec.write(next);
        morphChangeRepository.deleteAfter(simulation.getId(), simulation.getCurrentSeq());
        morphChangeRepository.save(
                MorphChange.record(
                        simulation.getId(),
                        nextSeq,
                        source,
                        changeRequestId,
                        delta,
                        state,
                        clamped,
                        summary));
        morphChangeRepository.deleteBefore(simulation.getId(), nextSeq - MAX_UNDO_STEPS);
        simulation.moveTo(state, nextSeq);
    }

    private EditResultResponse result(
            Simulation simulation, Boolean clamped, String undoneSummary, String redoneSummary) {
        return new EditResultResponse(
                codec.read(simulation.getMorphState()),
                simulation.getStateVersion(),
                simulation.getCurrentSeq(),
                clamped,
                canUndo(simulation),
                canRedo(simulation),
                undoneSummary,
                redoneSummary);
    }

    private SimulationResponse toResponse(Simulation simulation, Set<String> contourCodes) {
        MorphState state = codec.read(simulation.getMorphState());
        Map<String, MorphRange> catalog = morphParameterService.ranges(state.schemaVersion());
        EyeEditService.Support eyeSupport = eyeEditService.support(simulation.getFaceModelId());
        NoseCapabilities noseSupport = noseEditService.capabilities(simulation, catalog);
        boolean weightSupported = weightShapeSupported(simulation.getFaceModelId());
        return new SimulationResponse(
                simulation.getId(),
                simulation.getFaceModelId(),
                simulation.getTitle(),
                state,
                simulation.getStateVersion(),
                simulation.getCurrentSeq(),
                canUndo(simulation),
                canRedo(simulation),
                simulation.isHasChanges(),
                noseSupport,
                eyeSupport.review(),
                eyeSupport.eyePartsSha256(),
                eyeSupport.capabilities(),
                weightSupported,
                contourCodes == null
                        ? null
                        : editRanges(
                                catalog, noseSupport, eyeSupport, weightSupported, contourCodes),
                faceModels.existsByIdAndEditApprovalRetryAtIsNotNull(simulation.getFaceModelId()),
                null,
                simulation.getCreatedAt(),
                simulation.getUpdatedAt());
    }

    public static ModelEditRanges editRanges(
            Map<String, MorphRange> catalog,
            NoseCapabilities nose,
            EyeEditService.Support eye,
            boolean weightSupported,
            Set<String> contourCodes) {
        Map<String, ModelEditRanges.Range> weights = new TreeMap<>();
        if (nose != null) {
            nose.supported()
                    .forEach(
                            (code, range) ->
                                    weights.put(
                                            code,
                                            new ModelEditRanges.Range(range.min(), range.max())));
        }
        catalog.forEach(
                (code, range) -> {
                    if (contourCodes.contains(code)
                            || (weightSupported && WeightShapeEditGuard.CODE.equals(code))) {
                        weights.put(code, new ModelEditRanges.Range(range.min(), range.max()));
                    }
                });
        Map<String, ModelEditRanges.Range> eyes = new TreeMap<>();
        if (eye != null && eye.capabilities() != null) {
            eye.capabilities()
                    .limits()
                    .forEach(
                            (code, max) -> {
                                if (Double.isFinite(max) && max > 0)
                                    eyes.put(code, new ModelEditRanges.Range(0, max));
                            });
        }
        return new ModelEditRanges(Map.copyOf(weights), Map.copyOf(eyes));
    }

    public boolean canUndo(Simulation simulation) {
        return canMoveTo(simulation, simulation.getCurrentSeq() - 1);
    }

    public Optional<String> currentChatRequestId(Simulation simulation) {
        return morphChangeRepository
                .findBySimulationIdAndSeq(simulation.getId(), simulation.getCurrentSeq())
                .filter(change -> change.getSource() == MorphChangeSource.CHAT)
                .map(MorphChange::getChangeRequestId);
    }

    public boolean canRedo(Simulation simulation) {
        return canMoveTo(simulation, simulation.getCurrentSeq() + 1);
    }

    private boolean canMoveTo(Simulation simulation, int seq) {
        return morphChangeRepository
                .findBySimulationIdAndSeq(simulation.getId(), seq)
                .map(target -> canVisit(simulation, target.getStateAfter()))
                .orElse(false);
    }

    private boolean canVisit(Simulation simulation, String target) {
        try {
            MorphState before = codec.read(simulation.getMorphState());
            MorphState after = codec.read(target);
            if (!MorphEdits.preservesLocked(before.weights(), after.weights())) return false;
            weightShapeEditGuard.requireEligible(simulation, after);
            if (after.eyeEdit() != null) eyeEditService.validate(simulation, after.eyeEdit());
            return true;
        } catch (BusinessException e) {
            return false;
        }
    }

    /** 옛 이력의 내부 코끝 2개 값을 포함한 요약도 현재 사용자 조절 항목 기준으로 읽는다. */
    private String summaryOf(MorphChange change, MorphState before, MorphState after) {
        boolean own =
                change.getSource() == MorphChangeSource.SLIDER
                        || change.getSource() == MorphChangeSource.POINT
                        || change.getSource() == MorphChangeSource.RESET
                        || change.getSource() == MorphChangeSource.CHAT;
        if (!own || change.getSummary() == null) return GENERIC_SUMMARY;
        if (change.getSource() != MorphChangeSource.SLIDER
                && change.getSource() != MorphChangeSource.CHAT) return change.getSummary();
        Set<String> codes = new TreeSet<>(before.weights().keySet());
        codes.addAll(after.weights().keySet());
        List<MorphEdits.Change> changes =
                codes.stream()
                        .filter(
                                code ->
                                        !before.weights()
                                                .getOrDefault(code, 0.0)
                                                .equals(after.weights().getOrDefault(code, 0.0)))
                        .map(
                                code ->
                                        new MorphEdits.Change(
                                                code,
                                                before.weights().getOrDefault(code, 0.0),
                                                after.weights().getOrDefault(code, 0.0),
                                                false))
                        .toList();
        if (!MorphEdits.hasCoupledTipChanges(changes)) return change.getSummary();
        Map<String, MorphRange> ranges = morphParameterService.ranges(after.schemaVersion());
        return changes.stream().allMatch(c -> ranges.containsKey(c.code()))
                ? MorphEdits.summary(changes, ranges)
                : change.getSummary();
    }
}
