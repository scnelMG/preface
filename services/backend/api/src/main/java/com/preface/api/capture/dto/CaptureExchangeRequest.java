package com.preface.api.capture.dto;

import jakarta.validation.constraints.NotBlank;

/** API-QR-02 요청. 토큰 원문은 로그에 남기지 않는다(toString 가림). */
public record CaptureExchangeRequest(@NotBlank String token) {

    @Override
    public String toString() {
        return "CaptureExchangeRequest[token=***]";
    }
}
