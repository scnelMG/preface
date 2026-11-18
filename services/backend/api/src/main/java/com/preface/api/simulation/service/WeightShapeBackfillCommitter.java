package com.preface.api.simulation.service;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 검증 도중 모델·승인이 바뀌면 저장하지 않는다. 이 거래에는 외부 HTTP가 없다. */
@Service
@RequiredArgsConstructor
public class WeightShapeBackfillCommitter {
    private final FaceModelRepository models;
    private final EyeEditService eyeApproval;

    public record Proof(
            String modelId,
            String userId,
            String oldKey,
            String rigKey,
            String schemaVersion,
            String oldNose,
            String oldEye,
            String oldWeight,
            String newKey,
            String newNose,
            String newWeight,
            EyeApprovalRequest newEye) {}

    @Transactional
    public void commit(Proof proof) {
        commit(proof, false, null);
    }

    @Transactional
    public void commitCheekboneRepair(Proof proof) {
        commit(proof, true, null);
    }

    @Transactional
    public void commitContourRecovery(Proof proof, String source) {
        commit(proof, true, Objects.requireNonNull(source));
    }

    private void commit(Proof proof, boolean eyeAssetsVerified, String source) {
        FaceModel model =
                models.findOwnedForUpdate(proof.modelId(), proof.userId())
                        .orElseThrow(WeightShapeBackfillService::invalid);
        if (model.isDeleted()
                || !Objects.equals(model.getMeshObjectKey(), proof.oldKey())
                || !Objects.equals(model.getSourceMeshObjectKey(), source)
                || model.getPreviousMeshObjectKey() != null
                || !Objects.equals(model.getRigObjectKey(), proof.rigKey())
                || !Objects.equals(model.getMorphSchemaVersion(), proof.schemaVersion())
                || !Objects.equals(model.getApprovedNoseCapabilities(), proof.oldNose())
                || !Objects.equals(model.getApprovedEyeCapabilities(), proof.oldEye())
                || !Objects.equals(model.getApprovedWeightShape(), proof.oldWeight()))
            throw WeightShapeBackfillService.invalid();
        if (source == null) {
            model.activateWeightShapeMesh(
                    proof.oldKey(), proof.newKey(), proof.newNose(), proof.newWeight());
        } else {
            model.activateContourRecovery(
                    proof.oldKey(), proof.newKey(), proof.newNose(), proof.newWeight());
        }
        if (proof.newEye() != null
                && !(eyeAssetsVerified
                        ? eyeApproval.approveWithVerifiedAssets(proof.modelId(), proof.newEye())
                        : eyeApproval.approveForGeneration(proof.modelId(), proof.newEye()))) {
            throw WeightShapeBackfillService.invalid();
        }
    }
}
