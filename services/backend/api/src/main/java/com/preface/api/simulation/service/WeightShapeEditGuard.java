package com.preface.api.simulation.service;

import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.MorphState;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.Simulation;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** 생성 모델의 체중 변화 상태와 복합 형상 검사 결과를 확인한다. */
@Service
@RequiredArgsConstructor
public class WeightShapeEditGuard {
    static final String CODE = "contour.weight_shape";

    /** 잠금 밖에서 검사한 정확한 최종 상태와 자산 승인값. */
    public record Proof(
            String simulationId,
            int stateVersion,
            String faceModelId,
            String meshObjectKey,
            String approvedWeightShape,
            String schemaVersion,
            Map<String, Double> weights,
            FullBinding fullBinding) {
        public Proof(
                String simulationId,
                int stateVersion,
                String faceModelId,
                String meshObjectKey,
                String approvedWeightShape,
                String schemaVersion,
                Map<String, Double> weights) {
            this(
                    simulationId,
                    stateVersion,
                    faceModelId,
                    meshObjectKey,
                    approvedWeightShape,
                    schemaVersion,
                    weights,
                    null);
        }
    }

    public record FullBinding(
            String rigObjectKey,
            String noseApproval,
            String eyeApproval,
            String eyeReview,
            String eyePartsSha256,
            EyeEditState eyes) {
        static FullBinding of(FaceModel model, EyeEditState eyes) {
            return new FullBinding(
                    model.getRigObjectKey(),
                    model.getApprovedNoseCapabilities(),
                    model.getApprovedEyeCapabilities(),
                    model.getEyeReview(),
                    model.getEyePartsSha256(),
                    eyes);
        }
    }

    static EyeEditState activeEyes(MorphState state) {
        return EyeEditState.initial().equals(state.eyeEdit()) ? null : state.eyeEdit();
    }

    static List<String> activeOtherCodes(MorphState state) {
        return state.weights().entrySet().stream()
                .filter(e -> !CODE.equals(e.getKey()) && e.getValue() != null && e.getValue() != 0)
                .map(Map.Entry::getKey)
                .toList();
    }

    static boolean fullValidationRequired(MorphState state) {
        var codes = activeOtherCodes(state);
        return activeEyes(state) != null
                || codes.size() > 1
                || codes.stream()
                        .anyMatch(
                                code ->
                                        !WeightShapeModelApprovalService.CONTOUR_CODES.contains(
                                                code));
    }

    public static boolean hasFaceEdits(MorphState state) {
        return activeEyes(state) != null
                || !state.pointStrokes().isEmpty()
                || !activeOtherCodes(state).isEmpty();
    }

    public static MorphState requireExclusive(MorphState state) {
        if (state.weights().getOrDefault(CODE, 0.0) != 0 && hasFaceEdits(state)) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
        return state;
    }

    private final FaceModelRepository models;
    private final JsonMapper json;

    public boolean supported(String faceModelId) {
        return models.findById(faceModelId).filter(this::approved).isPresent();
    }

    public void requireSafe(Simulation simulation, MorphState state) {
        requireSafe(simulation, state, null);
    }

    public void requireSafe(Simulation simulation, MorphState state, Proof proof) {
        FaceModel model = requireEligible(simulation, state);
        if (model == null) return;
        if (proof == null
                || !Objects.equals(proof.simulationId(), simulation.getId())
                || proof.stateVersion() != simulation.getStateVersion()
                || !Objects.equals(proof.faceModelId(), model.getId())
                || !Objects.equals(proof.meshObjectKey(), model.getMeshObjectKey())
                || !Objects.equals(proof.approvedWeightShape(), model.getApprovedWeightShape())
                || !Objects.equals(proof.schemaVersion(), state.schemaVersion())
                || !Objects.equals(proof.weights(), state.weights())
                || (fullValidationRequired(state)
                        && !Objects.equals(
                                proof.fullBinding(), FullBinding.of(model, activeEyes(state))))) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
    }

    /** 이력 이동 가능성을 판단하며 실제 복원 시 최종 형상을 다시 검사한다. */
    FaceModel requireEligible(Simulation simulation, MorphState state) {
        Double weight = state.weights().get(CODE);
        if (weight == null || weight == 0) return null;
        FaceModel model = models.findById(simulation.getFaceModelId()).orElse(null);
        var others = activeOtherCodes(state);
        boolean combined = !others.isEmpty() || activeEyes(state) != null;
        if (!Double.isFinite(weight)
                || Math.abs(weight) > 1
                || MorphEdits.round(weight) != weight
                || state.weights().entrySet().stream()
                        .anyMatch(e -> e.getValue() == null || !Double.isFinite(e.getValue()))
                || !state.pointStrokes().isEmpty()
                || model == null
                || !model.getMorphSchemaVersion().equals(state.schemaVersion())
                || !approved(model)
                || others.stream()
                        .anyMatch(
                                code ->
                                        !code.startsWith("nose.")
                                                && !WeightShapeModelApprovalService.CONTOUR_CODES
                                                        .contains(code))) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
        return combined ? model : null;
    }

    /** 모델을 시안보다 먼저 잠가 삭제·재승인과 저장을 직렬화한다. */
    public void lockProofModel(String userId, Proof proof) {
        if (proof != null && models.findOwnedForUpdate(proof.faceModelId(), userId).isEmpty()) {
            throw new BusinessException(EditErrorCode.STATE_VERSION_CONFLICT);
        }
    }

    private boolean approved(FaceModel model) {
        if (model.isDeleted()
                || !"GLB".equals(model.getMeshFormat())
                || model.getApprovedWeightShape() == null) return false;
        try {
            WeightShapeModelApprovalService.Approval weight =
                    json.readValue(
                            model.getApprovedWeightShape(),
                            WeightShapeModelApprovalService.Approval.class);
            boolean bound =
                    Objects.equals(weight.meshObjectKey(), model.getMeshObjectKey())
                            && weight.meshObjectKey() != null;
            if ((weight.meshObjectKey() == null && model.getSourceMeshObjectKey() == null
                            || bound && model.getSourceMeshObjectKey() != null)
                    && model.getApprovedNoseCapabilities() != null) {
                NoseEditService.Approval nose =
                        json.readValue(
                                model.getApprovedNoseCapabilities(),
                                NoseEditService.Approval.class);
                bound =
                        nose.binding() != null
                                && model.getMorphSchemaVersion().equals(nose.schemaVersion())
                                && Objects.equals(weight.meshSha256(), nose.binding().meshSha256())
                                && Objects.equals(weight.fitSha(), nose.binding().fitSha());
            }
            return weight.version() == 1
                    && weight.modelVersion() == 1
                    && weight.meshSha256() != null
                    && weight.meshSha256().matches("[a-f0-9]{64}")
                    && weight.fitSha() != null
                    && weight.fitSha().matches("[a-f0-9]{12}")
                    && weight.negativeLimit() > 0
                    && weight.negativeLimit() <= 1
                    && weight.positiveLimit() > 0
                    && weight.positiveLimit() <= 1
                    && bound;
        } catch (Exception e) {
            return false;
        }
    }
}
