package com.preface.api.simulation.service;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.EyeCapabilities;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.api.simulation.dto.WeightShapeBackfillRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** 오래된 모델의 GLB·승인을 DB 잠금 밖에서 검증하고, 검증한 스냅샷만 저장한다. */
@Service
@RequiredArgsConstructor
public class WeightShapeBackfillService {
    private final FaceModelRepository models;
    private final WeightShapeModelApprovalService weightApproval;
    private final NoseEditService noseApproval;
    private final EyeEditService eyeApproval;
    private final WeightShapeBackfillCommitter committer;
    private final JsonMapper json;
    private final ReconstructionStorage storage;
    private final WeightContourValidatorClient contourValidator;

    public void activate(String modelId, WeightShapeBackfillRequest request) {
        FaceModel model = models.findById(modelId).orElseThrow(WeightShapeBackfillService::invalid);
        if (model.isDeleted() || !validKeys(model, request)) throw invalid();
        if (Objects.equals(model.getMeshObjectKey(), request.newKey())
                && Objects.equals(model.getSourceMeshObjectKey(), request.oldKey())) {
            try {
                WeightShapeModelApprovalService.Approval approved =
                        json.readValue(
                                model.getApprovedWeightShape(),
                                WeightShapeModelApprovalService.Approval.class);
                if (request.newSha256().equals(approved.meshSha256())
                        && request.newKey().equals(approved.meshObjectKey())) return;
            } catch (Exception ignored) {
                // A partial or corrupt prior activation must never be accepted as a retry.
            }
            throw invalid();
        }
        if (!"GLB".equals(model.getMeshFormat())
                || !request.oldKey().equals(model.getMeshObjectKey())
                || model.getSourceMeshObjectKey() != null
                || model.getApprovedWeightShape() != null) throw invalid();
        String weight =
                weightApproval.validateForBackfill(
                        request.oldKey(),
                        request.newKey(),
                        request.oldSha256(),
                        request.newSha256());
        if (weight == null) throw invalid();
        NoseEditService.Approval priorNose = readNose(model);
        String nose = null;
        if (priorNose != null) {
            if (model.getRigObjectKey() == null
                    || priorNose.binding() == null
                    || priorNose.ranges() == null
                    || !model.getMorphSchemaVersion().equals(priorNose.schemaVersion())
                    || !request.oldSha256().equals(priorNose.binding().meshSha256()))
                throw invalid();
            WeightShapeModelApprovalService.Approval shape =
                    json.readValue(weight, WeightShapeModelApprovalService.Approval.class);
            if (!shape.fitSha().equals(priorNose.binding().fitSha())) throw invalid();
            nose =
                    noseApproval.validateForGeneration(
                            request.newKey(),
                            model.getRigObjectKey(),
                            noseRequest(priorNose, request.newSha256()));
            if (nose == null) throw invalid();
        }
        EyeApprovalRequest eye = eyeRequest(model, priorNose, request);
        committer.commit(
                new WeightShapeBackfillCommitter.Proof(
                        modelId,
                        model.getUserId(),
                        model.getMeshObjectKey(),
                        model.getRigObjectKey(),
                        model.getMorphSchemaVersion(),
                        model.getApprovedNoseCapabilities(),
                        model.getApprovedEyeCapabilities(),
                        model.getApprovedWeightShape(),
                        request.newKey(),
                        nose,
                        weight,
                        eye));
    }

    public void activateCheekboneRepair(String modelId, WeightShapeBackfillRequest request) {
        FaceModel model = models.findById(modelId).orElseThrow(WeightShapeBackfillService::invalid);
        if (model.isDeleted()
                || !"GLB".equals(model.getMeshFormat())
                || !Objects.equals(model.getMeshObjectKey(), request.oldKey())
                || model.getSourceMeshObjectKey() != null
                || !validRepairKey(model, request)
                || !weightApproval.cheekboneRepairPreservesAssets(
                        request.oldKey(),
                        request.newKey(),
                        request.oldSha256(),
                        request.newSha256())) throw invalid();
        try {
            var binding = weightApproval.contourMeshBinding(model);
            if (!request.oldSha256().equals(binding.sha256())) throw invalid();
            String mesh = storage.presignGet(request.newKey()).url();
            for (Map<String, Double> weights :
                    java.util.List.of(
                            Map.of("contour.cheekbone", -0.1, "contour.jaw_angle", -0.1),
                            Map.of("contour.cheekbone", 0.1, "contour.jaw_angle", -0.1),
                            Map.of("contour.cheekbone", -0.1, "contour.jaw_angle", -0.3))) {
                if (!contourValidator.validateFull(
                        mesh,
                        request.newSha256(),
                        binding.fitSha(),
                        weights,
                        null,
                        null,
                        null,
                        null,
                        null)) throw invalid();
            }
            rebindExistingApprovals(modelId, model, request, null, binding);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception ignored) {
            throw invalid();
        }
    }

    public void activateContourRecovery(String modelId, WeightShapeBackfillRequest request) {
        FaceModel model = models.findById(modelId).orElseThrow(WeightShapeBackfillService::invalid);
        String source = model.getSourceMeshObjectKey();
        if (model.isDeleted()
                || !"GLB".equals(model.getMeshFormat())
                || source == null
                || model.getPreviousMeshObjectKey() != null
                || model.getApprovedWeightShape() == null
                || !Objects.equals(model.getMeshObjectKey(), request.oldKey())
                || !originalKey(model, source)) throw invalid();
        String parent = source.substring(0, source.lastIndexOf('/') + 1);
        if (!request.oldKey()
                        .equals(
                                parent
                                        + "mesh-weight-shape-v1-"
                                        + request.oldSha256().substring(0, 16)
                                        + ".glb")
                || !request.newKey()
                        .equals(parent + "mesh-contour-v1-" + request.newSha256() + ".glb"))
            throw invalid();
        try {
            var codes =
                    weightApproval.addedContourPairs(
                            request.oldKey(),
                            request.newKey(),
                            request.oldSha256(),
                            request.newSha256());
            if (codes.isEmpty()) throw invalid();
            var binding = weightApproval.contourMeshBinding(model);
            if (!request.oldSha256().equals(binding.sha256())) throw invalid();
            String mesh = storage.presignGet(request.newKey()).url();
            for (String code : codes) {
                for (double direction : new double[] {-1, 1}) {
                    if (!contourValidator.validateFull(
                            mesh,
                            request.newSha256(),
                            binding.fitSha(),
                            Map.of(code, direction),
                            null,
                            null,
                            null,
                            null,
                            null)) throw invalid();
                }
            }
            rebindExistingApprovals(modelId, model, request, source, binding);
        } catch (BusinessException e) {
            throw e;
        } catch (Exception ignored) {
            throw invalid();
        }
    }

    private void rebindExistingApprovals(
            String modelId,
            FaceModel model,
            WeightShapeBackfillRequest request,
            String contourSource,
            WeightShapeModelApprovalService.MeshBinding binding)
            throws Exception {
        NoseEditService.Approval oldNose = readNose(model);
        String nose = null;
        if (oldNose != null) {
            if (oldNose.binding() == null
                    || !request.oldSha256().equals(oldNose.binding().meshSha256())) throw invalid();
            nose =
                    noseApproval.validateForGeneration(
                            request.newKey(),
                            model.getRigObjectKey(),
                            noseRequest(oldNose, request.newSha256()));
            if (nose == null
                    || !oldNose.ranges()
                            .equals(json.readValue(nose, NoseEditService.Approval.class).ranges()))
                throw invalid();
        }
        String weight = null;
        if (model.getApprovedWeightShape() != null) {
            var before =
                    json.readValue(
                            model.getApprovedWeightShape(),
                            WeightShapeModelApprovalService.Approval.class);
            if (!request.oldSha256().equals(before.meshSha256())
                    || (before.meshObjectKey() != null
                            && !request.oldKey().equals(before.meshObjectKey()))
                    || !binding.fitSha().equals(before.fitSha())) throw invalid();
            weight =
                    json.writeValueAsString(
                            new WeightShapeModelApprovalService.Approval(
                                    before.version(),
                                    request.newSha256(),
                                    before.fitSha(),
                                    before.modelVersion(),
                                    before.negativeLimit(),
                                    before.positiveLimit(),
                                    request.newKey()));
        }
        EyeApprovalRequest eye = eyeRequest(model, oldNose, request, true);
        if (eye != null) {
            var review = json.readValue(model.getEyeReview(), EyeReview.class);
            if (!eyeApproval.verifyAssets(
                    request.newKey(),
                    model.getRigObjectKey(),
                    Map.of("R", review.R(), "L", review.L()),
                    eye)) throw invalid();
        }
        var proof =
                new WeightShapeBackfillCommitter.Proof(
                        modelId,
                        model.getUserId(),
                        request.oldKey(),
                        model.getRigObjectKey(),
                        model.getMorphSchemaVersion(),
                        model.getApprovedNoseCapabilities(),
                        model.getApprovedEyeCapabilities(),
                        model.getApprovedWeightShape(),
                        request.newKey(),
                        nose,
                        weight,
                        eye);
        if (contourSource == null) committer.commitCheekboneRepair(proof);
        else committer.commitContourRecovery(proof, contourSource);
    }

    private static boolean validRepairKey(FaceModel model, WeightShapeBackfillRequest request) {
        String parent = "users/" + model.getUserId() + "/models/";
        String old = request.oldKey();
        return old.startsWith(parent)
                && old.matches(
                        "users/[a-zA-Z0-9_-]+/models/[a-zA-Z0-9_-]+/(?:a[1-9][0-9]*/)?(?:head|mesh)\\.glb")
                && (old.startsWith(parent + model.getId() + "/")
                        || old.startsWith(parent + model.getReconstructionJobId() + "/"))
                && request.newKey()
                        .equals(
                                old.substring(0, old.lastIndexOf('/') + 1)
                                        + "mesh-cheekbone-v1-"
                                        + request.newSha256()
                                        + ".glb");
    }

    private EyeApprovalRequest eyeRequest(
            FaceModel model, NoseEditService.Approval nose, WeightShapeBackfillRequest request) {
        return eyeRequest(model, nose, request, false);
    }

    private EyeApprovalRequest eyeRequest(
            FaceModel model,
            NoseEditService.Approval nose,
            WeightShapeBackfillRequest request,
            boolean allowIndependentApproval) {
        if (model.getApprovedEyeCapabilities() == null) return null;
        EyeEditService.Support support = eyeApproval.support(model.getId());
        EyeCapabilities eye = support.capabilities();
        if ((!allowIndependentApproval && nose == null)
                || eye == null
                || !request.oldSha256().equals(eye.meshSha256())) throw invalid();
        return new EyeApprovalRequest(
                eye.schemaVersion(),
                new EyeApprovalRequest.Binding(
                        request.newSha256(),
                        eye.rigSha256(),
                        eye.eyePartsSha256(),
                        eye.engine(),
                        eye.rigVersion(),
                        eye.topologyVersion()),
                eye.limits());
    }

    private NoseEditService.Approval readNose(FaceModel model) {
        try {
            return model.getApprovedNoseCapabilities() == null
                    ? null
                    : json.readValue(
                            model.getApprovedNoseCapabilities(), NoseEditService.Approval.class);
        } catch (Exception e) {
            throw invalid();
        }
    }

    private static NoseApprovalRequest noseRequest(
            NoseEditService.Approval approval, String meshSha) {
        NoseEditValidation.Binding binding = approval.binding();
        Map<String, NoseApprovalRequest.Range> ranges =
                approval.ranges().entrySet().stream()
                        .collect(
                                Collectors.toMap(
                                        Map.Entry::getKey,
                                        e ->
                                                new NoseApprovalRequest.Range(
                                                        e.getValue().min(), e.getValue().max())));
        return new NoseApprovalRequest(
                approval.schemaVersion(),
                new NoseApprovalRequest.Binding(
                        meshSha,
                        binding.rigSha256(),
                        binding.fitSha(),
                        binding.engine(),
                        binding.rigVersion(),
                        binding.topologyVersion()),
                ranges);
    }

    private static boolean validKeys(FaceModel model, WeightShapeBackfillRequest request) {
        String old = request.oldKey(), next = request.newKey();
        if (old == null
                || next == null
                || request.newSha256() == null
                || !request.newSha256().matches("[a-f0-9]{64}")) return false;
        return originalKey(model, old)
                && next.equals(
                        old.substring(0, old.lastIndexOf('/') + 1)
                                + "mesh-weight-shape-v1-"
                                + request.newSha256().substring(0, 16)
                                + ".glb");
    }

    private static boolean originalKey(FaceModel model, String old) {
        String user = model.getUserId();
        String job = model.getReconstructionJobId();
        String parent = "users/" + user + "/models/";
        boolean jobKey =
                old.matches(
                        java.util.regex.Pattern.quote(parent + job)
                                + "/(?:a[1-9][0-9]*/)?mesh\\.glb");
        boolean modelKey =
                old.matches(
                        java.util.regex.Pattern.quote(parent + model.getId())
                                + "/a[1-9][0-9]*/head\\.glb");
        return jobKey || modelKey;
    }

    static BusinessException invalid() {
        return new BusinessException(CommonErrorCode.INVALID_REQUEST);
    }
}
