package com.preface.api.capture.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.JsonNode;

/**
 * API-CAP-01 요청. 형식·크기·길이·촬영 방식 정책 위반은 여기서가 아니라 서비스가 CAP_002로 거절한다(정책 값이 설정에 있어서).
 *
 * @param checksumSha256 원본 파일 SHA-256(32바이트)의 base64. 44자
 * @param captureMethod {@code WEB_RECORDER}(웹 녹화)만 받는다(S15P31B204-929). {@code FILE}(파일
 *     올리기)·없음(null)·그 밖의 값은 서비스가 CAP_002로 거절한다. DB·관리자 응답의 {@code FILE}은 예전 업로드 기록에만 남는다
 * @param deviceModel FE가 아는 기종(1~100자). 렌즈 출발값으로만 쓰고 영상 안 기록이 있으면 그쪽이 이긴다
 * @param captureTrace 웹 녹화 촬영 기록(S15P31B204-640, 선택). 웹 녹화일 때만 저장하고, 모양이 어긋나면 업로드는 받고 기록만 버린다. 모양:
 *     {@code contracts/frame-extraction/schemas/claim-response.schema.json}의 {@code capture.trace}
 */
public record UploadRequest(
        @NotBlank String contentType,
        @NotNull Long sizeBytes,
        @NotNull Integer durationMs,
        @NotBlank @Pattern(regexp = "^[A-Za-z0-9+/]{43}=$", message = "SHA-256 base64(44자)여야 해요.")
                String checksumSha256,
        String captureMethod,
        @Size(max = 100) String deviceModel,
        JsonNode captureTrace) {

    /** 촬영 기록 없이(웹 가이드가 기록을 보내기 전). */
    public UploadRequest(
            String contentType,
            Long sizeBytes,
            Integer durationMs,
            String checksumSha256,
            String captureMethod,
            String deviceModel) {
        this(contentType, sizeBytes, durationMs, checksumSha256, captureMethod, deviceModel, null);
    }
}
