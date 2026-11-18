package com.preface.api.admin.dto;

import java.time.Instant;
import java.util.List;

/**
 * 관리자: 3D 파일·촬영 사진 presigned GET(5분, S15P31B204-653). {@link #toString()}은 URL을 가린다(로그에 남지 않게).
 *
 * @param texturedMeshUrl 사용자 화면이 여는 것과 같은 GLB({@code face_model.mesh_object_key}, 텍스처 포함)
 * @param baseMeshUrl 텍스처 전 메시. 아직 저장하지 않아 항상 {@code null}
 * @param captureImages 운영에서는 빈 배열(REQ-N-25)
 */
public record AdminFaceModelAssetsResponse(
        String faceModelId,
        Instant expiresAt,
        String texturedMeshUrl,
        String baseMeshUrl,
        String thumbnailUrl,
        List<CaptureImage> captureImages) {

    public AdminFaceModelAssetsResponse {
        captureImages = List.copyOf(captureImages);
    }

    @Override
    public String toString() {
        return "AdminFaceModelAssetsResponse[faceModelId="
                + faceModelId
                + ", expiresAt="
                + expiresAt
                + ", captureImages="
                + captureImages.size()
                + ", urls=<redacted>]";
    }

    public record CaptureImage(String angle, String url) {

        @Override
        public String toString() {
            return "CaptureImage[angle=" + angle + ", url=<redacted>]";
        }
    }
}
