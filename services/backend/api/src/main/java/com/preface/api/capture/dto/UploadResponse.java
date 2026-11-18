package com.preface.api.capture.dto;

import java.time.Instant;
import java.util.Map;

/**
 * API-CAP-01 응답. FE는 {@code headers}를 그대로 붙여 {@code uploadUrl}에 PUT한다.
 *
 * <p>{@code uploadUrl}은 서명 원문이라 toString에 넣지 않는다(로그 유출 방지).
 */
public record UploadResponse(
        String uploadId,
        String uploadUrl,
        String method,
        Map<String, String> headers,
        Instant expiresAt) {

    @Override
    public String toString() {
        return "UploadResponse[uploadId="
                + uploadId
                + ", uploadUrl=***, expiresAt="
                + expiresAt
                + "]";
    }
}
