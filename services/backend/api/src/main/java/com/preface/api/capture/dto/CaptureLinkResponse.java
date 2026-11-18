package com.preface.api.capture.dto;

import java.time.Instant;

/** API-QR-01 응답. {@code qrUrl}에 1회용 토큰이 fragment로 들어 있어 toString에 넣지 않는다. */
public record CaptureLinkResponse(String linkId, String qrUrl, Instant expiresAt) {

    @Override
    public String toString() {
        return "CaptureLinkResponse[linkId=" + linkId + ", qrUrl=***, expiresAt=" + expiresAt + "]";
    }
}
