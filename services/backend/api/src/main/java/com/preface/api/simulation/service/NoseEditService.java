package com.preface.api.simulation.service;

import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.api.reconstruction.service.NoseModelApproval;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.MorphState;
import com.preface.api.simulation.dto.NoseCapabilities;
import com.preface.api.simulation.dto.PointStroke;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.EditErrorCode;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.Simulation;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** 승인된 원본·리그·코 범위와 CPU 최종 메시 검사를 묶는 서버 편집 경계. */
@Service
@RequiredArgsConstructor
public class NoseEditService implements NoseModelApproval {

    private final FaceModelRepository faceModelRepository;
    private final ReconstructionStorage storage;
    private final NoseEditValidatorClient validator;
    private final JsonMapper json;
    private final MorphParameterService morphParameterService;
    private final TransactionTemplate transactions;

    private static final Set<String> FIRST_RELEASE_CODES =
            Set.of(
                    "nose.bridge_height",
                    "nose.tip_projection",
                    "nose.tip_height",
                    "nose.tip_rotation",
                    "nose.alar_width");

    @Override
    public String validateForGeneration(
            String meshObjectKey, String rigObjectKey, NoseApprovalRequest request) {
        try {
            return validated(meshObjectKey, rigObjectKey, request.schemaVersion(), request, true)
                    .json();
        } catch (NoseEditValidation.Unavailable e) {
            // 검사기가 답하지 못했을 뿐 결과는 멀쩡할 수 있다. 워커가 3D를 다시 만들지 않고 같은 결과를 다시 보내게 한다(S15P31B204-592)
            throw new BusinessException(ReconstructionErrorCode.RESULT_CHECK_UNAVAILABLE);
        }
    }

    /** 내부 작업자가 제출한 범위의 원본/리그 결속과 각 끝값을 검사한 뒤에만 모델을 연다. */
    public NoseCapabilities approve(String modelId, NoseApprovalRequest request) {
        FaceModel model =
                faceModelRepository
                        .findById(modelId)
                        .filter(m -> !m.isDeleted() && m.getRigObjectKey() != null)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        Validated validated;
        try {
            validated =
                    validated(
                            model.getMeshObjectKey(),
                            model.getRigObjectKey(),
                            model.getMorphSchemaVersion(),
                            request,
                            false);
        } catch (NoseEditValidation.Unavailable e) {
            throw new BusinessException(EditErrorCode.NOSE_EDIT_NOT_READY);
        }
        transactions.executeWithoutResult(
                status -> {
                    FaceModel current =
                            faceModelRepository
                                    .findOwnedForUpdate(modelId, model.getUserId())
                                    .orElseThrow(
                                            () -> new BusinessException(CommonErrorCode.NOT_FOUND));
                    if (!Objects.equals(model.getMeshObjectKey(), current.getMeshObjectKey())
                            || !Objects.equals(model.getRigObjectKey(), current.getRigObjectKey())
                            || !Objects.equals(
                                    model.getApprovedNoseCapabilities(),
                                    current.getApprovedNoseCapabilities())) {
                        throw new BusinessException(EditErrorCode.NOSE_EDIT_NOT_READY);
                    }
                    current.approveNose(validated.json());
                });
        return validated.capabilities();
    }

    private record Validated(String json, NoseCapabilities capabilities) {}

    void verifySavedNoseStates(
            String meshKey, String rigKey, String approvalJson, Set<MorphState> states) {
        Approval approval = json.readValue(approvalJson, Approval.class);
        var supported =
                supported(
                        approval.ranges(),
                        morphParameterService.ranges(approval.schemaVersion()),
                        false);
        String meshUrl = storage.presignGet(meshKey).url();
        String rigUrl = storage.presignGet(rigKey).url();
        for (MorphState state : states) {
            var weights = noseWeights(state.weights());
            weights.values().removeIf(value -> value == 0);
            if (weights.isEmpty() && state.pointStrokes().isEmpty()) continue;
            if (!approval.schemaVersion().equals(state.schemaVersion())
                    || !supported.keySet().containsAll(weights.keySet())
                    || weights.entrySet().stream()
                            .anyMatch(
                                    entry -> {
                                        MorphRange range = supported.get(entry.getKey());
                                        return !Double.isFinite(entry.getValue())
                                                || entry.getValue() < range.min()
                                                || entry.getValue() > range.max();
                                    }))
                throw new BusinessException(EditErrorCode.NOSE_EDIT_NOT_READY);
            var checked =
                    validator.validate(
                            meshUrl,
                            rigUrl,
                            approval.binding(),
                            supported,
                            Map.of(),
                            weights,
                            List.of(),
                            state.pointStrokes());
            if (!weights.equals(checked.weights())
                    || !state.pointStrokes().equals(checked.points())) {
                throw new BusinessException(EditErrorCode.NOSE_EDIT_NOT_READY);
            }
        }
    }

    /** 요청 모양과 검사기 왕복(기본값 1회 + 끝값마다 1회)으로 승인 JSON을 만든다. DB를 건드리지 않는다. */
    private Validated validated(
            String meshObjectKey,
            String rigObjectKey,
            String modelSchemaVersion,
            NoseApprovalRequest request,
            boolean useCatalogIntersection) {
        if (request == null
                || request.binding() == null
                || request.ranges() == null
                || request.ranges().isEmpty()
                || !FIRST_RELEASE_CODES.containsAll(request.ranges().keySet())
                || modelSchemaVersion == null
                || !modelSchemaVersion.equals(request.schemaVersion())
                || !request.binding().meshSha256().matches("[a-f0-9]{64}")
                || !request.binding().rigSha256().matches("[a-f0-9]{64}")) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        try {
            Map<String, Bounds> requested = new HashMap<>();
            request.ranges()
                    .forEach(
                            (code, range) ->
                                    requested.put(code, new Bounds(range.min(), range.max())));
            Map<String, MorphRange> supported =
                    supported(
                            requested,
                            morphParameterService.ranges(request.schemaVersion()),
                            useCatalogIntersection);
            if (supported.isEmpty()
                    || supported.values().stream().anyMatch(r -> r.min() == 0 && r.max() == 0)) {
                throw new NoseEditValidation.InvalidResult();
            }
            NoseEditValidation.Binding binding =
                    new NoseEditValidation.Binding(
                            request.binding().meshSha256(),
                            request.binding().rigSha256(),
                            request.binding().fitSha(),
                            request.binding().engine(),
                            request.binding().rigVersion(),
                            request.binding().topologyVersion());
            String meshUrl = storage.presignGet(meshObjectKey).url();
            String rigUrl = storage.presignGet(rigObjectKey).url();
            validator.validate(meshUrl, rigUrl, binding, supported, Map.of(), Map.of());
            for (MorphRange range : supported.values()) {
                for (double end : new double[] {range.min(), range.max()}) {
                    if (end == 0) continue;
                    Map<String, Double> actual =
                            validator.validate(
                                    meshUrl,
                                    rigUrl,
                                    binding,
                                    supported,
                                    Map.of(),
                                    Map.of(range.code(), end));
                    if (!actual.equals(Map.of(range.code(), end))) {
                        throw new NoseEditValidation.InvalidResult();
                    }
                }
            }
            Map<String, NoseCapabilities.Range> ranges = new HashMap<>();
            Map<String, Bounds> verified = new HashMap<>();
            supported.forEach(
                    (code, range) -> {
                        ranges.put(code, new NoseCapabilities.Range(range.min(), range.max()));
                        verified.put(code, new Bounds(range.min(), range.max()));
                    });
            return new Validated(
                    json.writeValueAsString(
                            new Approval(request.schemaVersion(), binding, verified)),
                    new NoseCapabilities(
                            binding.topologyVersion(),
                            binding.rigVersion(),
                            binding.engine(),
                            ranges));
        } catch (BusinessException | NoseEditValidation.Unavailable e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(EditErrorCode.NOSE_EDIT_NOT_READY);
        }
    }

    @Transactional
    public void revoke(String modelId) {
        FaceModel model =
                faceModelRepository
                        .findById(modelId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        faceModelRepository
                .findOwnedForUpdate(modelId, model.getUserId())
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND))
                .revokeNose();
    }

    public NoseCapabilities capabilities(Simulation simulation, Map<String, MorphRange> catalog) {
        FaceModel model = faceModelRepository.findById(simulation.getFaceModelId()).orElse(null);
        if (model == null
                || model.isDeleted()
                || !model.isChatApplyReady()
                || model.getApprovedNoseCapabilities() == null) {
            return null;
        }
        try {
            Approval approval = json.readValue(model.getApprovedNoseCapabilities(), Approval.class);
            if (!model.getMorphSchemaVersion().equals(approval.schemaVersion())
                    || approval.binding() == null) {
                return null;
            }
            Map<String, MorphRange> supported = supported(approval.ranges(), catalog, false);
            Map<String, NoseCapabilities.Range> ranges = new HashMap<>();
            supported.forEach(
                    (code, range) ->
                            ranges.put(code, new NoseCapabilities.Range(range.min(), range.max())));
            return new NoseCapabilities(
                    approval.binding().topologyVersion(),
                    approval.binding().rigVersion(),
                    approval.binding().engine(),
                    ranges);
        } catch (Exception e) {
            return null;
        }
    }

    public MorphEdits.Applied validate(
            Simulation simulation,
            Map<String, Double> current,
            MorphEdits.Applied candidate,
            Map<String, MorphRange> catalog,
            boolean chat) {
        return validate(simulation, current, candidate, catalog, List.of(), chat);
    }

    public MorphEdits.Applied validate(
            Simulation simulation,
            Map<String, Double> current,
            MorphEdits.Applied candidate,
            Map<String, MorphRange> catalog,
            List<PointStroke> points,
            boolean chat) {
        Map<String, Double> noseBefore = noseWeights(current);
        if (noseBefore.equals(noseWeights(candidate.weights()))) {
            // 코가 그대로인 편집(윤곽만 바꿈)은 코 검사기를 부르지 않는다. 윤곽은 GLB morph target이라 MorphEdits가 카탈로그 범위로만
            // 자른다. 코 승인이 없는 모델도 윤곽은 저장할 수 있다(지원 여부는 웹이 GLB 타깃 유무로 판단).
            FaceModel model =
                    faceModelRepository.findById(simulation.getFaceModelId()).orElse(null);
            if (model == null || model.isDeleted()) {
                throw new BusinessException(
                        chat
                                ? EditErrorCode.CHAT_APPLY_NOT_SUPPORTED
                                : EditErrorCode.NOSE_EDIT_NOT_READY);
            }
            return MorphEdits.withActual(current, candidate, noseBefore);
        }
        NoseEditValidation.Checked actual =
                check(simulation, current, candidate.weights(), points, points, catalog, chat);
        return MorphEdits.withActual(current, candidate, actual.weights());
    }

    public List<PointStroke> validatePoints(
            Simulation simulation,
            Map<String, Double> weights,
            List<PointStroke> current,
            List<PointStroke> candidate,
            Map<String, MorphRange> catalog) {
        return check(simulation, weights, weights, current, candidate, catalog, false).points();
    }

    private NoseEditValidation.Checked check(
            Simulation simulation,
            Map<String, Double> current,
            Map<String, Double> candidate,
            List<PointStroke> currentPoints,
            List<PointStroke> candidatePoints,
            Map<String, MorphRange> catalog,
            boolean chat) {
        try {
            NoseEditValidation.requirePointShape(currentPoints);
            NoseEditValidation.requirePointShape(candidatePoints);
        } catch (NoseEditValidation.InvalidResult e) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        EditErrorCode error =
                chat ? EditErrorCode.CHAT_APPLY_NOT_SUPPORTED : EditErrorCode.NOSE_EDIT_NOT_READY;
        FaceModel model = faceModelRepository.findById(simulation.getFaceModelId()).orElse(null);
        if (model == null
                || model.isDeleted()
                || !model.isChatApplyReady()
                || model.getRigObjectKey() == null
                || model.getApprovedNoseCapabilities() == null) {
            throw new BusinessException(error);
        }
        try {
            Approval approval = json.readValue(model.getApprovedNoseCapabilities(), Approval.class);
            if (approval == null
                    || !model.getMorphSchemaVersion().equals(approval.schemaVersion())
                    || approval.binding() == null
                    || approval.ranges() == null
                    || approval.ranges().isEmpty()) {
                throw new NoseEditValidation.InvalidResult();
            }
            Map<String, MorphRange> supported = supported(approval.ranges(), catalog, false);
            Map<String, Double> before = noseWeights(current);
            Map<String, Double> wanted = noseWeights(candidate);
            if (!supported.keySet().containsAll(before.keySet())
                    || !supported.keySet().containsAll(wanted.keySet())) {
                throw new NoseEditValidation.InvalidResult();
            }
            wanted.replaceAll(
                    (code, value) ->
                            Math.clamp(
                                    value, supported.get(code).min(), supported.get(code).max()));
            return validator.validate(
                    storage.presignGet(model.getMeshObjectKey()).url(),
                    storage.presignGet(model.getRigObjectKey()).url(),
                    approval.binding(),
                    supported,
                    before,
                    wanted,
                    currentPoints,
                    candidatePoints);
        } catch (NoseEditValidation.UnsafeResult e) {
            throw new BusinessException(EditErrorCode.UNSAFE_NOSE_EDIT);
        } catch (Exception e) {
            // 서명 URL·검사기 본문·S3 내부 오류는 외부 응답에 싣지 않는다.
            throw new BusinessException(error);
        }
    }

    private static Map<String, Double> noseWeights(Map<String, Double> weights) {
        Map<String, Double> nose = new HashMap<>();
        weights.forEach(
                (code, value) -> {
                    if (code.startsWith("nose.")) nose.put(code, value);
                });
        return nose;
    }

    private static Map<String, MorphRange> supported(
            Map<String, Bounds> approved,
            Map<String, MorphRange> catalog,
            boolean useCatalogIntersection) {
        Map<String, MorphRange> ranges = new HashMap<>();
        approved.forEach(
                (code, bounds) -> {
                    MorphRange common = catalog.get(code);
                    if (common == null
                            || !code.startsWith("nose.")
                            || bounds == null
                            || !Double.isFinite(bounds.min())
                            || !Double.isFinite(bounds.max())
                            || bounds.min() < -1
                            || bounds.max() > 1
                            || (!useCatalogIntersection
                                    && (bounds.min() < common.min() || bounds.max() > common.max()))
                            || bounds.min() > 0
                            || bounds.max() < 0) {
                        throw new NoseEditValidation.InvalidResult();
                    }
                    double min = Math.max(common.min(), bounds.min());
                    double max = Math.min(common.max(), bounds.max());
                    if (useCatalogIntersection
                            && min == 0
                            && max == 0
                            && (bounds.min() != 0 || bounds.max() != 0)) {
                        return;
                    }
                    ranges.put(code, new MorphRange(code, common.label(), min, max));
                });
        return ranges;
    }

    public record Approval(
            String schemaVersion, NoseEditValidation.Binding binding, Map<String, Bounds> ranges) {}

    public record Bounds(double min, double max) {}
}
