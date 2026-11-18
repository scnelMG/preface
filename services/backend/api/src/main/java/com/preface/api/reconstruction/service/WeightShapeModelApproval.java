package com.preface.api.reconstruction.service;

/** Reads the uploaded GLB before result storage; missing or unsafe targets stay unavailable. */
public interface WeightShapeModelApproval {
    /**
     * @return JSON for face_model.approved_weight_shape, or null when unsupported.
     */
    String validateForGeneration(String meshObjectKey, String noseApprovalJson);
}
