package com.preface.api.facemodel.dto;

import java.time.Instant;

/** 내 3D의 정면 사진 presigned GET URL(10분, S15P31B204-604). {@link #toString()}은 URL을 가린다. */
public record FrontPhotoResponse(String url, Instant expiresAt) {

    @Override
    public String toString() {
        return "FrontPhotoResponse[url=<redacted>, expiresAt=" + expiresAt + "]";
    }
}
