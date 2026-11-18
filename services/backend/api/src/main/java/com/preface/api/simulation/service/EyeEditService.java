package com.preface.api.simulation.service;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.reconstruction.service.EyeModelApproval;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.EyeCapabilities;
import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.Simulation;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** 눈 판정과 모델별 승인 범위가 모두 있는 3D만 눈 상태를 저장한다. */
@Service
@RequiredArgsConstructor
public class EyeEditService implements EyeModelApproval {
    private static final Set<String> STYLES = Set.of("inline", "inout", "outline");
    private static final Set<String> TRIMS = Set.of("inner", "outer", "lower", "upper");
    private static final Set<String> LIMIT_KEYS =
            Set.of(
                    "inner",
                    "outer",
                    "lower",
                    "upper",
                    "inline:height",
                    "inout:height",
                    "outline:height");
    private final FaceModelRepository faceModelRepository;
    private final ReconstructionStorage storage;
    private final EyeEditValidatorClient validator;
    private final JsonMapper json;

    public record Support(EyeReview review, EyeCapabilities capabilities, String eyePartsSha256) {}

    /** 잠금 없이 검사한 상태와 결속. 저장 거래에서 모두 다시 확인한다. */
    public record Proof(
            String faceModelId,
            String meshObjectKey,
            String rigObjectKey,
            Support support,
            EyeEditState state) {}

    public Proof prepare(Simulation simulation, EyeEditState state) {
        validate(simulation, state);
        FaceModel model = faceModelRepository.findById(simulation.getFaceModelId()).orElse(null);
        if (model == null
                || model.isDeleted()
                || model.getMeshObjectKey() == null
                || model.getRigObjectKey() == null) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
        Support approved = support(model.getId());
        if (approved.review() == null || approved.capabilities() == null) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
        EyeCapabilities capabilities = approved.capabilities();
        try {
            boolean safe =
                    validator.validate(
                            storage.presignGet(model.getMeshObjectKey()).url(),
                            storage.presignGet(model.getRigObjectKey()).url(),
                            new EyeEditValidatorClient.EyeCapabilitiesBinding(
                                    capabilities.meshSha256(),
                                    capabilities.rigSha256(),
                                    capabilities.eyePartsSha256()),
                            approved.review(),
                            state);
            if (!safe) throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
        return new Proof(
                model.getId(), model.getMeshObjectKey(), model.getRigObjectKey(), approved, state);
    }

    /** 코 편집이 그대로 보존할 눈 변형만 잠금 밖에서 검사한다. */
    public Proof preparePreserved(Simulation simulation, EyeEditState state) {
        return state == null || EyeEditState.initial().equals(state)
                ? null
                : prepare(simulation, state);
    }

    public EyeEditState validatePrepared(Simulation simulation, EyeEditState state, Proof proof) {
        validate(simulation, state);
        FaceModel model = faceModelRepository.findById(simulation.getFaceModelId()).orElse(null);
        if (proof == null
                || !state.equals(proof.state())
                || model == null
                || model.isDeleted()
                || !model.getId().equals(proof.faceModelId())
                || !java.util.Objects.equals(model.getMeshObjectKey(), proof.meshObjectKey())
                || !java.util.Objects.equals(model.getRigObjectKey(), proof.rigObjectKey())
                || !support(model.getId()).equals(proof.support())) {
            throw new BusinessException(EditErrorCode.STATE_VERSION_CONFLICT);
        }
        return state;
    }

    /** 삭제·승인 변경과 같은 순서로 모델을 먼저 잠근 뒤 시안 행을 잠근다. */
    public void lockProofModel(String userId, Proof proof) {
        if (proof != null
                && faceModelRepository.findOwnedForUpdate(proof.faceModelId(), userId).isEmpty()) {
            throw new BusinessException(EditErrorCode.STATE_VERSION_CONFLICT);
        }
    }

    public Support support(String faceModelId) {
        FaceModel model = faceModelRepository.findById(faceModelId).orElse(null);
        if (model == null || model.isDeleted() || model.getEyeReview() == null) {
            return new Support(null, null, null);
        }
        try {
            EyeReview review = json.readValue(model.getEyeReview(), EyeReview.class);
            if (!review.known()) return new Support(null, null, null);
            EyeCapabilities approved = null;
            if (model.getApprovedEyeCapabilities() != null) {
                EyeCapabilities candidate =
                        json.readValue(model.getApprovedEyeCapabilities(), EyeCapabilities.class);
                if (bound(model, candidate)
                        && (model.getApprovedNoseCapabilities() == null
                                || matchesNoseBinding(model, candidate))) approved = candidate;
            }
            return new Support(review, approved, model.getEyePartsSha256());
        } catch (RuntimeException ignored) {
            return new Support(null, null, null);
        }
    }

    /**
     * 생성 결과의 눈 승인 후보를 저장한다(S15P31B204-521). 같은 거래에서 방금 승인한 코 결속, 저장된 판정 파일 해시와 모두 같고 한계 키·값이 맞을 때만
     * 저장한다. 서버가 메시로 한계를 다시 계산하지는 않는다.
     */
    @Override
    public boolean approveForGeneration(String modelId, EyeApprovalRequest request) {
        return approve(modelId, request, false);
    }

    @Override
    public boolean verifyAssets(
            String meshObjectKey,
            String rigObjectKey,
            Map<String, String> review,
            EyeApprovalRequest request) {
        if (review == null || request.binding() == null) return false;
        var binding = request.binding();
        try {
            return validator.validate(
                    storage.presignGet(meshObjectKey).url(),
                    storage.presignGet(rigObjectKey).url(),
                    new EyeEditValidatorClient.EyeCapabilitiesBinding(
                            binding.meshSha256(), binding.rigSha256(), binding.eyePartsSha256()),
                    new EyeReview(review.get("R"), review.get("L")),
                    EyeEditState.initial());
        } catch (EyeEditValidatorClient.Unavailable e) {
            throw new BusinessException(ReconstructionErrorCode.RESULT_CHECK_UNAVAILABLE);
        } catch (RuntimeException e) {
            return false;
        }
    }

    @Override
    public boolean approveWithVerifiedAssets(String modelId, EyeApprovalRequest request) {
        return approve(modelId, request, true);
    }

    private boolean approve(String modelId, EyeApprovalRequest request, boolean assetsVerified) {
        if (request == null || request.binding() == null || request.limits() == null) return false;
        FaceModel model = faceModelRepository.findById(modelId).orElse(null);
        if (model == null || model.isDeleted() || model.getEyeReview() == null) return false;
        EyeApprovalRequest.Binding binding = request.binding();
        EyeCapabilities candidate =
                new EyeCapabilities(
                        request.schemaVersion(),
                        binding.meshSha256(),
                        binding.rigSha256(),
                        binding.eyePartsSha256(),
                        binding.engine(),
                        binding.rigVersion(),
                        binding.topologyVersion(),
                        request.limits());
        try {
            if (!LIMIT_KEYS.containsAll(candidate.limits().keySet())
                    || !candidate.limits().keySet().containsAll(TRIMS)
                    || !json.readValue(model.getEyeReview(), EyeReview.class).known()
                    || !bound(model, candidate)
                    || (!assetsVerified && !matchesNoseBinding(model, candidate))) {
                return false;
            }
            model.approveEyes(json.writeValueAsString(candidate));
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private boolean matchesNoseBinding(FaceModel model, EyeCapabilities candidate) {
        if (model.getApprovedNoseCapabilities() == null) return false;
        NoseEditService.Approval nose =
                json.readValue(model.getApprovedNoseCapabilities(), NoseEditService.Approval.class);
        return nose.binding() != null
                && candidate.meshSha256().equals(nose.binding().meshSha256())
                && candidate.rigSha256().equals(nose.binding().rigSha256())
                && candidate.engine().equals(nose.binding().engine())
                && candidate.rigVersion().equals(nose.binding().rigVersion())
                && candidate.topologyVersion().equals(nose.binding().topologyVersion());
    }

    /** 자산을 바꾸면 눈 승인을 지우므로, 저장된 눈 승인은 코 승인 상태와 독립적으로 읽는다. */
    private boolean bound(FaceModel model, EyeCapabilities candidate) {
        return model.getMeshObjectKey() != null
                && model.getRigObjectKey() != null
                && candidate.meshSha256() != null
                && candidate.meshSha256().matches("[a-f0-9]{64}")
                && candidate.rigSha256() != null
                && candidate.rigSha256().matches("[a-f0-9]{64}")
                && candidate.eyePartsSha256() != null
                && candidate.eyePartsSha256().equals(model.getEyePartsSha256())
                && candidate.schemaVersion() != null
                && candidate.schemaVersion().equals(model.getMorphSchemaVersion())
                && candidate.engine() != null
                && candidate.rigVersion() != null
                && candidate.topologyVersion() != null
                && candidate.limits() != null
                && candidate.limits().values().stream()
                        .allMatch(v -> v != null && Double.isFinite(v) && v >= 0 && v <= 100);
    }

    public EyeEditState validate(Simulation simulation, EyeEditState state) {
        Support support = support(simulation.getFaceModelId());
        if (support.review() == null || support.capabilities() == null || state == null) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
        Map<String, Double> limits = support.capabilities().limits();
        validateEye(state.L(), support.review().L(), limits);
        validateEye(state.R(), support.review().R(), limits);
        return state;
    }

    private static void validateEye(
            EyeEditState.EyeSettings eye, String review, Map<String, Double> limits) {
        if (eye == null
                || eye.values() == null
                || eye.style() == null
                || !STYLES.contains(eye.style())
                || eye.curve() == null
                || eye.curve().size() != 5
                || eye.curve().stream()
                        .anyMatch(v -> v == null || !Double.isFinite(v) || v < 0.005 || v > 0.36)) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
        EyeEditState.Values v = eye.values();
        java.util.List<Double> designed = EyeEditState.curve(v.height(), eye.style());
        if (v.crease() != 65
                || !valid(v.height(), 100)
                || !valid(v.inner(), limit(limits, "inner"))
                || !valid(v.outer(), limit(limits, "outer"))
                || !valid(v.lower(), limit(limits, "lower"))
                || !valid(v.upper(), limit(limits, "upper"))
                || java.util.stream.IntStream.range(0, 5)
                        .anyMatch(i -> Math.abs(eye.curve().get(i) - designed.get(i)) > 1e-6)
                || (eye.enabled()
                        && (!"absent".equals(review)
                                || limit(limits, eye.style() + ":height") <= 0
                                || !valid(v.height(), limit(limits, eye.style() + ":height"))))) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
    }

    private static double limit(Map<String, Double> limits, String key) {
        return limits.getOrDefault(key, 0.0);
    }

    private static boolean valid(double value, double max) {
        return Double.isFinite(value) && value >= 0 && value <= max;
    }
}
