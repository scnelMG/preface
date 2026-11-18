package com.preface.api.simulation.service;

import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.EyeCapabilities;
import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.api.simulation.dto.MorphState;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.simulation.entity.Simulation;
import java.util.Map;
import java.util.TreeMap;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** 승인된 체중 변화와 윤곽 한 항목의 실제 최종 메시를 행 잠금 밖에서 검사한다. */
@Service
@RequiredArgsConstructor
public class WeightContourEditService {
    private final WeightShapeEditGuard guard;
    private final WeightShapeModelApprovalService contourSupport;
    private final ReconstructionStorage storage;
    private final WeightContourValidatorClient validator;
    private final JsonMapper json;

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void requireSafeContour(FaceModel model, Map<String, Double> weights) {
        requireSafeFace(model, weights, null);
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void requireSafeFace(FaceModel model, Map<String, Double> weights, EyeEditState eyes) {
        try {
            var contourCodes =
                    weights.keySet().stream()
                            .filter(WeightShapeModelApprovalService.CONTOUR_CODES::contains)
                            .toList();
            if (model != null
                    && (contourCodes.isEmpty()
                            || contourSupport
                                    .supportedContourCodes(model)
                                    .containsAll(contourCodes))) {
                var nose =
                        model.getApprovedNoseCapabilities() == null
                                ? null
                                : json.readValue(
                                        model.getApprovedNoseCapabilities(),
                                        NoseEditService.Approval.class);
                var binding =
                        nose == null || nose.binding() == null
                                ? contourSupport.contourMeshBinding(model)
                                : new WeightShapeModelApprovalService.MeshBinding(
                                        nose.binding().meshSha256(), nose.binding().fitSha());
                if (validateFull(
                        model,
                        binding,
                        storage.presignGet(model.getMeshObjectKey()).url(),
                        weights,
                        eyes)) {
                    return;
                }
            }
        } catch (Exception ignored) {
            // 자산 URL이나 검사기 상세를 사용자 응답에 싣지 않는다.
        }
        throw new BusinessException(EditErrorCode.UNSAFE_CONTOUR_EDIT);
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public WeightShapeEditGuard.Proof prepare(Simulation simulation, MorphState state) {
        Double weight = state.weights().get(WeightShapeEditGuard.CODE);
        if (weight == null || weight == 0) return null;
        FaceModel model = guard.requireEligible(simulation, state);
        if (model == null) return null;
        var contour =
                WeightShapeEditGuard.activeOtherCodes(state).stream()
                        .filter(WeightShapeModelApprovalService.CONTOUR_CODES::contains)
                        .toList();
        if (model.getMeshObjectKey() == null
                || (!contour.isEmpty()
                        && !contourSupport.supportedContourCodes(model).containsAll(contour))) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
        try {
            WeightShapeModelApprovalService.Approval approval =
                    json.readValue(
                            model.getApprovedWeightShape(),
                            WeightShapeModelApprovalService.Approval.class);
            double limit = weight < 0 ? approval.negativeLimit() : approval.positiveLimit();
            if (Math.abs(weight) > limit) {
                throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
            }
            Map<String, Double> active = new TreeMap<>();
            state.weights()
                    .forEach(
                            (code, value) -> {
                                if (value != 0) active.put(code, value);
                            });
            boolean full = WeightShapeEditGuard.fullValidationRequired(state);
            EyeEditState eyes = WeightShapeEditGuard.activeEyes(state);
            String meshUrl = storage.presignGet(model.getMeshObjectKey()).url();
            boolean valid =
                    full
                            ? validateFull(
                                    model,
                                    new WeightShapeModelApprovalService.MeshBinding(
                                            approval.meshSha256(), approval.fitSha()),
                                    meshUrl,
                                    active,
                                    eyes)
                            : validator.validate(
                                    meshUrl, approval.meshSha256(), approval.fitSha(), active);
            if (!valid) throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
            return new WeightShapeEditGuard.Proof(
                    simulation.getId(),
                    simulation.getStateVersion(),
                    model.getId(),
                    model.getMeshObjectKey(),
                    model.getApprovedWeightShape(),
                    state.schemaVersion(),
                    Map.copyOf(state.weights()),
                    full ? WeightShapeEditGuard.FullBinding.of(model, eyes) : null);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
    }

    private boolean validateFull(
            FaceModel model,
            WeightShapeModelApprovalService.MeshBinding binding,
            String meshUrl,
            Map<String, Double> weights,
            EyeEditState eyes) {
        String rigSha = null;
        var noseCodes = weights.keySet().stream().filter(code -> code.startsWith("nose.")).toList();
        if (!noseCodes.isEmpty()) {
            var nose =
                    json.readValue(
                            model.getApprovedNoseCapabilities(), NoseEditService.Approval.class);
            if (!model.isChatApplyReady()
                    || !model.getMorphSchemaVersion().equals(nose.schemaVersion())
                    || !binding.sha256().equals(nose.binding().meshSha256())
                    || !binding.fitSha().equals(nose.binding().fitSha())
                    || !noseCodes.stream()
                            .allMatch(
                                    code -> {
                                        var range = nose.ranges().get(code);
                                        return range != null
                                                && weights.get(code) >= range.min()
                                                && weights.get(code) <= range.max();
                                    })) return false;
            rigSha = nose.binding().rigSha256();
        }
        EyeReview review = null;
        String eyePartsSha = null;
        if (eyes != null) {
            var caps = json.readValue(model.getApprovedEyeCapabilities(), EyeCapabilities.class);
            review = json.readValue(model.getEyeReview(), EyeReview.class);
            if (!review.known()
                    || !model.getMorphSchemaVersion().equals(caps.schemaVersion())
                    || !binding.sha256().equals(caps.meshSha256())
                    || !caps.eyePartsSha256().equals(model.getEyePartsSha256())
                    || (rigSha != null && !rigSha.equals(caps.rigSha256()))) return false;
            eyePartsSha = caps.eyePartsSha256();
            rigSha = caps.rigSha256();
        }
        if ((!noseCodes.isEmpty() || eyes != null)
                && (rigSha == null || model.getRigObjectKey() == null)) return false;
        String rigUrl = rigSha == null ? null : storage.presignGet(model.getRigObjectKey()).url();
        return validator.validateFull(
                meshUrl,
                binding.sha256(),
                binding.fitSha(),
                weights,
                rigUrl,
                rigSha,
                eyePartsSha,
                review,
                eyes);
    }
}
