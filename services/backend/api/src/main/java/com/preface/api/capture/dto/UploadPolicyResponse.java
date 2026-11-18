package com.preface.api.capture.dto;

import java.util.List;

/**
 * API-CAP-02 응답.
 *
 * @param partSizeBytes multipart 업로드 조각 크기(S15P31B204-506). 이보다 큰 파일은 조각으로 나눠 올린다
 */
public record UploadPolicyResponse(Video video, long uploadUrlTtlSec, long partSizeBytes) {

    public record Video(
            List<String> allowedContentTypes,
            long maxSizeBytes,
            int minDurationMs,
            int maxDurationMs,
            int recommendedDurationMs) {}
}
