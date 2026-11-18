package com.preface.api.notification.service;

import java.net.http.HttpClient;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * SSAFY Mattermost incoming webhook으로 한 사람에게 DM을 보낸다(S15P31B204-476).
 *
 * <p>{@code "channel": "@아이디"}면 webhook을 만든 계정과 그 사람의 DM 방에 글이 올라간다. 없는 아이디면 Mattermost가 4xx를 준다.
 * 예외 메시지에 webhook URL이 들어갈 수 있어 로그에는 상태 코드·예외 종류만 남긴다.
 *
 * <p>SSAFY Mattermost는 봇 계정과 발신자 이름 바꾸기({@code EnablePostUsernameOverride})가 꺼져 있어, 받는 사람에게는
 * webhook을 만든 팀원의 개인 DM으로 보인다. 그래서 모든 글을 {@code :preface:}(SSAFY MM 커스텀 이모지) 머리줄로 시작해 Preface 알림임을
 * 드러내고, 맨 아래에 자동 알림이라고 밝힌다(S15P31B204-532). 이모지 이름을 바꾸거나 지우면 글자 그대로 보인다.
 */
@Slf4j
@Component
class MattermostWebhookClient {

    static final String SENDER_NAME = "Preface 알림";

    static final String HEADER = ":preface: **Preface 알림**";

    /** 빈 줄을 두고 구분선을 그린다(바로 윗줄에 붙이면 Markdown이 그 줄을 제목으로 읽는다). */
    static final String FOOTER = "\n\n---\n이 메시지는 Preface가 자동으로 보냈어요 · 답장은 확인하지 않아요";

    enum Result {
        SENT,
        /** Mattermost가 요청을 거절했다(대개 없는 아이디) */
        REJECTED,
        /** 연결 실패·시간 초과·5xx */
        FAILED
    }

    private final MattermostProperties properties;
    private final RestClient restClient;

    MattermostWebhookClient(MattermostProperties properties, RestClient.Builder builder) {
        this.properties = properties;
        HttpClient httpClient =
                HttpClient.newBuilder().connectTimeout(properties.timeout()).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(properties.timeout());
        this.restClient = builder.clone().requestFactory(factory).build();
    }

    boolean enabled() {
        return properties.enabled();
    }

    Result sendDirect(String username, String text) {
        if (!properties.enabled()) {
            return Result.FAILED;
        }
        try {
            restClient
                    .post()
                    .uri(properties.webhookUrl())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload(username, text))
                    .retrieve()
                    .toBodilessEntity();
            return Result.SENT;
        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value();
            log.warn("mattermost webhook status={}", status);
            return status >= 400 && status < 500 ? Result.REJECTED : Result.FAILED;
        } catch (RestClientException e) {
            log.warn("mattermost webhook failed: {}", e.getClass().getSimpleName());
            return Result.FAILED;
        }
    }

    static Map<String, String> payload(String username, String text) {
        return Map.of(
                "channel",
                "@" + username,
                "text",
                HEADER + "\n" + text + FOOTER,
                "username",
                SENDER_NAME);
    }
}
