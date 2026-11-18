package com.preface.api.share.dto;

import java.time.Instant;

/** API-SHR-01. {@code shareUrl}에 토큰 원문이 들어 있어 이 응답에서만 한 번 준다. 로그에 남지 않게 {@code toString}에서 가린다. */
public record ShareCreateResponse(String shareId, String shareUrl, Instant expiresAt) {

    @Override
    public String toString() {
        return "ShareCreateResponse[shareId="
                + shareId
                + ", shareUrl=<redacted>, expiresAt="
                + expiresAt
                + "]";
    }
}
