package com.preface.jobmanager.notification.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Mattermost 실패 알림({@code preface.mattermost.*}, S15P31B204-530). api의 같은 키·같은 환경 변수를 쓴다.
 *
 * @param webhookUrl SSAFY Mattermost incoming webhook. 비밀값이라 환경 변수로만 받고 로그에 남기지 않는다. 비어 있으면 보내지 않는다
 * @param webBaseUrl DM 속 "바로 가기" 링크의 FE 주소. 비어 있으면 링크 없이 보낸다
 * @param timeout webhook 연결·응답 제한 시간
 */
@ConfigurationProperties("preface.mattermost")
public record MattermostProperties(String webhookUrl, String webBaseUrl, Duration timeout) {

    public MattermostProperties {
        webhookUrl = webhookUrl == null ? "" : webhookUrl.trim();
        webBaseUrl = webBaseUrl == null ? "" : webBaseUrl.trim();
        if (webBaseUrl.endsWith("/")) {
            webBaseUrl = webBaseUrl.substring(0, webBaseUrl.length() - 1);
        }
        timeout = timeout == null ? Duration.ofSeconds(3) : timeout;
    }

    public boolean enabled() {
        return !webhookUrl.isEmpty();
    }
}
