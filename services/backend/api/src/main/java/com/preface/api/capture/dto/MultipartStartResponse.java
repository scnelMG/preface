package com.preface.api.capture.dto;

import java.time.Instant;
import java.util.List;

/**
 * multipart 업로드 시작 응답(S15P31B204-506). 모든 조각 URL을 한 번에 준다. {@code expiresAt}이 지나면 API-CAP-06으로 다시
 * 받는다.
 */
public record MultipartStartResponse(
        String uploadId, long partSizeBytes, List<MultipartPartUrl> parts, Instant expiresAt) {}
