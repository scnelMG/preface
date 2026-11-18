package com.preface.api.facemodel.dto;

import java.time.Instant;
import java.util.Map;

/** 썸네일 PUT presigned URL(10분). {@code headers}를 그대로 붙여 올린다. {@link #toString()}은 URL을 가린다. */
public record ThumbnailUploadResponse(
        String objectKey, String uploadUrl, Map<String, String> headers, Instant expiresAt) {

    @Override
    public String toString() {
        return "ThumbnailUploadResponse[objectKey=" + objectKey + ", uploadUrl=<redacted>]";
    }
}
