package com.preface.api.facemodel.dto;

/** API-HIS-03. 소프트 삭제만 하고 물리·S3 삭제는 30일 뒤 배치가 하므로 항상 {@code PENDING}이다. */
public record FaceModelDeleteResponse(String deletionStatus) {

    public static FaceModelDeleteResponse pending() {
        return new FaceModelDeleteResponse("PENDING");
    }
}
