package com.preface.api.capture.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import tools.jackson.databind.JsonNode;

/**
 * multipart 업로드 시작 요청(S15P31B204-506, 명세 반영 전 가칭 API-CAP-05). 형식·크기·길이·촬영 방식 정책은 CAP-01과 같다(웹 녹화
 * {@code WEB_RECORDER}만 받는다, S15P31B204-929).
 *
 * @param checksumSha256 원본 파일 전체 SHA-256(base64 44자). 프레임 추출기가 내려받은 영상과 비교한다
 * @param partChecksums 조각 순서대로 각 조각의 SHA-256(base64 44자). 조각 크기는 API-CAP-02 {@code partSizeBytes}
 */
public record MultipartStartRequest(
        @NotBlank String contentType,
        @NotNull Long sizeBytes,
        @NotNull Integer durationMs,
        @NotBlank @Pattern(regexp = "^[A-Za-z0-9+/]{43}=$", message = "SHA-256 base64(44자)여야 해요.")
                String checksumSha256,
        @NotEmpty @Size(max = 10_000)
                List<
                                @NotNull
                                @Pattern(
                                        regexp = "^[A-Za-z0-9+/]{43}=$",
                                        message = "SHA-256 base64(44자)여야 해요.")
                                String>
                        partChecksums,
        String captureMethod,
        @Size(max = 100) String deviceModel,
        JsonNode captureTrace) {

    public UploadRequest toUploadRequest() {
        return new UploadRequest(
                contentType,
                sizeBytes,
                durationMs,
                checksumSha256,
                captureMethod,
                deviceModel,
                captureTrace);
    }
}
