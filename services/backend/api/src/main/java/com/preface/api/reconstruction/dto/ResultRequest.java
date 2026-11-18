package com.preface.api.reconstruction.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * INT-REC-03 요청. 계약: {@code contracts/reconstruction/schemas/result-request.schema.json}.
 *
 * <p>성공·실패 필드를 한 record에 두고, status별 필수 값은 서비스가 검사한다.
 *
 * @param videoMeta 계약에 있는 키만 받는다. 그 밖의 키(위치 등)는 역직렬화에서 버려진다
 * @param captureImages 5방향 얼굴 사진 S3 key. SUCCEEDED면 5개 모두 필수(키 검사는 서비스)
 * @param hairMeta 추정 머리 속성(S15P31B204-551). 없거나 형식이 틀리면 저장하지 않고 생성은 성공으로 둔다(best-effort). 그래서 여기서는
 *     bean 검증을 걸지 않는다
 * @param expressionObjectKey 표정 트래킹 리그 S3 key(선택, S15P31B204-879). 있으면 발급한 key와 같아야 한다(키 검사는 서비스)
 */
public record ResultRequest(
        @NotNull @Pattern(regexp = "SUCCEEDED|FAILED") String status,
        @Size(max = 500) String meshObjectKey,
        @Size(max = 500) String rigObjectKey,
        @Size(max = 500) String textureObjectKey,
        @Size(max = 500) String thumbnailObjectKey,
        String meshFormat,
        @Pattern(regexp = "^v[0-9]+$") @Size(max = 20) String morphSchemaVersion,
        Map<String, Object> measurements,
        @Size(max = 10) List<String> failCodes,
        String debugMessage,
        Map<String, Object> qualityReport,
        @Valid VideoMeta videoMeta,
        @Min(0) @Max(86_400_000) Integer durationMs,
        Map<String, @Size(max = 500) String> captureImages,
        @Valid NoseApprovalRequest noseApproval,
        Map<String, String> eyeReview,
        @Pattern(regexp = "^[a-f0-9]{64}$") String eyePartsSha256,
        EyeApprovalRequest eyeApproval,
        HairMeta hairMeta,
        @Size(max = 500) String expressionObjectKey) {

    public ResultRequest(
            String status,
            String meshObjectKey,
            String rigObjectKey,
            String textureObjectKey,
            String thumbnailObjectKey,
            String meshFormat,
            String morphSchemaVersion,
            Map<String, Object> measurements,
            List<String> failCodes,
            String debugMessage,
            Map<String, Object> qualityReport,
            VideoMeta videoMeta,
            Integer durationMs,
            Map<String, String> captureImages,
            NoseApprovalRequest noseApproval,
            Map<String, String> eyeReview,
            String eyePartsSha256,
            EyeApprovalRequest eyeApproval,
            HairMeta hairMeta) {
        this(
                status,
                meshObjectKey,
                rigObjectKey,
                textureObjectKey,
                thumbnailObjectKey,
                meshFormat,
                morphSchemaVersion,
                measurements,
                failCodes,
                debugMessage,
                qualityReport,
                videoMeta,
                durationMs,
                captureImages,
                noseApproval,
                eyeReview,
                eyePartsSha256,
                eyeApproval,
                hairMeta,
                null);
    }

    public ResultRequest(
            String status,
            String meshObjectKey,
            String rigObjectKey,
            String textureObjectKey,
            String thumbnailObjectKey,
            String meshFormat,
            String morphSchemaVersion,
            Map<String, Object> measurements,
            List<String> failCodes,
            String debugMessage,
            Map<String, Object> qualityReport,
            VideoMeta videoMeta,
            Integer durationMs,
            Map<String, String> captureImages,
            NoseApprovalRequest noseApproval,
            Map<String, String> eyeReview,
            String eyePartsSha256,
            EyeApprovalRequest eyeApproval) {
        this(
                status,
                meshObjectKey,
                rigObjectKey,
                textureObjectKey,
                thumbnailObjectKey,
                meshFormat,
                morphSchemaVersion,
                measurements,
                failCodes,
                debugMessage,
                qualityReport,
                videoMeta,
                durationMs,
                captureImages,
                noseApproval,
                eyeReview,
                eyePartsSha256,
                eyeApproval,
                null);
    }

    public ResultRequest(
            String status,
            String meshObjectKey,
            String rigObjectKey,
            String textureObjectKey,
            String thumbnailObjectKey,
            String meshFormat,
            String morphSchemaVersion,
            Map<String, Object> measurements,
            List<String> failCodes,
            String debugMessage,
            Map<String, Object> qualityReport,
            VideoMeta videoMeta,
            Integer durationMs,
            Map<String, String> captureImages,
            NoseApprovalRequest noseApproval,
            Map<String, String> eyeReview,
            String eyePartsSha256) {
        this(
                status,
                meshObjectKey,
                rigObjectKey,
                textureObjectKey,
                thumbnailObjectKey,
                meshFormat,
                morphSchemaVersion,
                measurements,
                failCodes,
                debugMessage,
                qualityReport,
                videoMeta,
                durationMs,
                captureImages,
                noseApproval,
                eyeReview,
                eyePartsSha256,
                null);
    }

    public ResultRequest(
            String status,
            String meshObjectKey,
            String rigObjectKey,
            String textureObjectKey,
            String thumbnailObjectKey,
            String meshFormat,
            String morphSchemaVersion,
            Map<String, Object> measurements,
            List<String> failCodes,
            String debugMessage,
            Map<String, Object> qualityReport,
            VideoMeta videoMeta,
            Integer durationMs,
            Map<String, String> captureImages,
            NoseApprovalRequest noseApproval,
            Map<String, String> eyeReview) {
        this(
                status,
                meshObjectKey,
                rigObjectKey,
                textureObjectKey,
                thumbnailObjectKey,
                meshFormat,
                morphSchemaVersion,
                measurements,
                failCodes,
                debugMessage,
                qualityReport,
                videoMeta,
                durationMs,
                captureImages,
                noseApproval,
                eyeReview,
                null,
                null);
    }

    public ResultRequest(
            String status,
            String meshObjectKey,
            String rigObjectKey,
            String textureObjectKey,
            String thumbnailObjectKey,
            String meshFormat,
            String morphSchemaVersion,
            Map<String, Object> measurements,
            List<String> failCodes,
            String debugMessage,
            Map<String, Object> qualityReport,
            VideoMeta videoMeta,
            Integer durationMs,
            Map<String, String> captureImages,
            NoseApprovalRequest noseApproval) {
        this(
                status,
                meshObjectKey,
                rigObjectKey,
                textureObjectKey,
                thumbnailObjectKey,
                meshFormat,
                morphSchemaVersion,
                measurements,
                failCodes,
                debugMessage,
                qualityReport,
                videoMeta,
                durationMs,
                captureImages,
                noseApproval,
                null,
                null,
                null);
    }

    public boolean succeeded() {
        return "SUCCEEDED".equals(status);
    }

    /** 계약 {@code hairMeta}. 값 검사는 서비스가 한다(틀리면 버림). */
    public record HairMeta(
            String schemaVersion,
            String length,
            String bangs,
            String part,
            String color,
            String rgb) {}

    public record VideoMeta(
            Integer width,
            Integer height,
            Double fps,
            @Size(max = 50) String codec,
            Integer durationMs,
            Integer rotation,
            Boolean hdr,
            Long bitrate,
            @Size(max = 100) String deviceMake,
            @Size(max = 100) String deviceModel,
            Instant recordedAt,
            @Size(max = 100) String encoder,
            Boolean originalSuspect) {}
}
