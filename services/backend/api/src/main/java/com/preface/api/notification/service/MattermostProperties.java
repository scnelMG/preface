package com.preface.api.notification.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Mattermost 완료 알림({@code preface.mattermost.*}, S15P31B204-476).
 *
 * @param webhookUrl SSAFY Mattermost incoming webhook. 채널 고정을 끈 것이어야 {@code "channel": "@아이디"}로 DM이
 *     간다. 비밀값이라 환경 변수로만 받고 로그에 남기지 않는다. 비어 있으면 기능이 꺼진다(등록 NOTI_001, 완료 DM 안 보냄)
 * @param webBaseUrl DM 속 "바로 가기" 링크의 FE 주소. 비어 있으면 링크 없이 보낸다
 * @param codeTtl 확인 코드 유효 시간
 * @param resendInterval 확인 코드를 다시 받을 수 있는 간격
 * @param maxAttempts 코드 하나로 틀릴 수 있는 횟수. 넘으면 코드를 버린다
 * @param timeout webhook 연결·응답 제한 시간
 */
@ConfigurationProperties("preface.mattermost")
public record MattermostProperties(
        String webhookUrl,
        String webBaseUrl,
        Duration codeTtl,
        Duration resendInterval,
        int maxAttempts,
        Duration timeout) {

    public MattermostProperties {
        webhookUrl = webhookUrl == null ? "" : webhookUrl.trim();
        webBaseUrl = webBaseUrl == null ? "" : webBaseUrl.trim();
        if (webBaseUrl.endsWith("/")) {
            webBaseUrl = webBaseUrl.substring(0, webBaseUrl.length() - 1);
        }
        codeTtl = codeTtl == null ? Duration.ofMinutes(10) : codeTtl;
        resendInterval = resendInterval == null ? Duration.ofSeconds(60) : resendInterval;
        maxAttempts = maxAttempts <= 0 ? 5 : maxAttempts;
        timeout = timeout == null ? Duration.ofSeconds(3) : timeout;
    }

    public boolean enabled() {
        return !webhookUrl.isEmpty();
    }
}
