package com.preface.api.share.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 시안 공유({@code preface.share.*}, S15P31B204-574).
 *
 * @param webBaseUrl 공유 링크가 여는 FE 주소. {@code {webBaseUrl}/s/{token}}
 * @param facePublicMinVersion 공유를 만들 수 있는 {@code FACE_PUBLIC} 동의서 최소 버전. 비어 있으면 아무도 공유를 만들 수 없다 —
 *     공유를 닫는 스위치다. 기본값({@code application.yml})은 가입 때 받는 v1 {@code 2026-10-v1}이다(2026-11-10 사용자 결정,
 *     S15P31B204-749)
 * @param ttl 공유 링크 수명. 7일
 */
@ConfigurationProperties("preface.share")
public record ShareProperties(String webBaseUrl, String facePublicMinVersion, Duration ttl) {

    public ShareProperties {
        webBaseUrl = webBaseUrl == null ? "" : webBaseUrl;
        if (webBaseUrl.endsWith("/")) {
            webBaseUrl = webBaseUrl.substring(0, webBaseUrl.length() - 1);
        }
        if (ttl == null) {
            ttl = Duration.ofDays(7);
        }
    }

    public boolean sharingOpen() {
        return facePublicMinVersion != null && !facePublicMinVersion.isBlank();
    }
}
