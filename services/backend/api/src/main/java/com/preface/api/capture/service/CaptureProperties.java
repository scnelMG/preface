package com.preface.api.capture.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * QR 휴대폰 연결({@code preface.capture.*}).
 *
 * @param qrBaseUrl QR이 여는 FE 주소. {@code {qrBaseUrl}/m/capture#t={token}}
 * @param linkTtl QR 토큰 유효 시간(교환 전). 180초
 * @param sessionTtl 업로드 전용 세션(JWT) 수명. 30분, refresh 없음
 */
@ConfigurationProperties("preface.capture")
public record CaptureProperties(String qrBaseUrl, Duration linkTtl, Duration sessionTtl) {

    public CaptureProperties {
        if (qrBaseUrl == null || qrBaseUrl.isBlank()) {
            throw new IllegalStateException(
                    "preface.capture.qr-base-url(CAPTURE_QR_BASE_URL) is required");
        }
        qrBaseUrl =
                qrBaseUrl.endsWith("/")
                        ? qrBaseUrl.substring(0, qrBaseUrl.length() - 1)
                        : qrBaseUrl;
    }
}
