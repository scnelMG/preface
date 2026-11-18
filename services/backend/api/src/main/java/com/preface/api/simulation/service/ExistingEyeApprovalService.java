package com.preface.api.simulation.service;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
@RequiredArgsConstructor
public class ExistingEyeApprovalService {
    private final FaceModelRepository models;
    private final EyeEditService eyeApproval;
    private final TransactionTemplate transactions;
    private final JsonMapper json;

    public void restore(String modelId, EyeApprovalRequest request) {
        FaceModel model =
                models.findById(modelId)
                        .filter(m -> !m.isDeleted())
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        String mesh = model.getMeshObjectKey(), rig = model.getRigObjectKey();
        String reviewJson = model.getEyeReview(), parts = model.getEyePartsSha256();
        String schema = model.getMorphSchemaVersion();
        if (request == null
                || request.binding() == null
                || mesh == null
                || rig == null
                || reviewJson == null
                || parts == null
                || !parts.equals(request.binding().eyePartsSha256())
                || !Objects.equals(schema, request.schemaVersion())) throw invalid();
        EyeReview review = json.readValue(reviewJson, EyeReview.class);
        if (!review.known()
                || !eyeApproval.verifyAssets(
                        mesh, rig, Map.of("L", review.L(), "R", review.R()), request))
            throw invalid();

        // 검증 중 자산 교체나 삭제, 다른 복구가 일어났는지 잠금 아래 확인한다.
        transactions.executeWithoutResult(
                status -> {
                    FaceModel current =
                            models.findOwnedForUpdate(modelId, model.getUserId())
                                    .orElseThrow(
                                            () -> new BusinessException(CommonErrorCode.NOT_FOUND));
                    if (!mesh.equals(current.getMeshObjectKey())
                            || !rig.equals(current.getRigObjectKey())
                            || !reviewJson.equals(current.getEyeReview())
                            || !parts.equals(current.getEyePartsSha256())
                            || !Objects.equals(schema, current.getMorphSchemaVersion()))
                        throw invalid();
                    if (current.getApprovedEyeCapabilities() == null
                            && !eyeApproval.approveWithVerifiedAssets(modelId, request))
                        throw invalid();
                });
    }

    private static BusinessException invalid() {
        return new BusinessException(CommonErrorCode.INVALID_REQUEST);
    }
}
