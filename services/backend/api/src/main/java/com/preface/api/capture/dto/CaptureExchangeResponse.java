package com.preface.api.capture.dto;

/** API-QR-02 응답. 업로드 전용 세션(JWT, refresh 없음). 토큰은 toString에 넣지 않는다. */
public record CaptureExchangeResponse(
        String captureSessionToken, long expiresIn, String linkId, UserView user) {

    public record UserView(String nickname, String maskedEmail) {}

    @Override
    public String toString() {
        return "CaptureExchangeResponse[captureSessionToken=***, expiresIn="
                + expiresIn
                + ", linkId="
                + linkId
                + "]";
    }
}
