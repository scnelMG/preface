package com.preface.jobmanager.notification.service;

import com.preface.common.notification.entity.NotificationType;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * job-manager가 끝낸 3D 실패(lease 2회 만료, GPU 대기 시간 초과)를 등록된 Mattermost 아이디로도 알린다(S15P31B204-530).
 *
 * <p>문안·규칙은 api {@code MattermostNotifier}·{@code MattermostWebhookClient}와 같다({@code :preface:}
 * 머리줄·맨 아래 자동 알림 안내, 제목·본문은 {@link NotificationType#RECON_FAILED}, 링크는 FE 알림 이동과 같은 {@code
 * /reconstructions/{id}}). job-manager가 api 모듈에 의존하지 않아 여기 따로 둔다 — 한쪽을 바꾸면 다른 쪽도 함께 바꾼다.
 *
 * <p>작업을 끝내는 트랜잭션이 커밋된 뒤 스케줄러 스레드에서 바로 보낸다. 실패해도 작업 상태·인앱 알림은 그대로다(로그만, 예외를 밖으로 던지지 않는다). 예외 메시지에
 * webhook URL이 들어갈 수 있어 로그에는 상태 코드·예외 종류만 남긴다.
 */
@Slf4j
@Component
@EnableConfigurationProperties(MattermostProperties.class)
public class MattermostReconNotifier {

    static final String SENDER_NAME = "Preface 알림";

    static final String HEADER = ":preface: **Preface 알림**";

    static final String FOOTER = "\n\n---\n이 메시지는 Preface가 자동으로 보냈어요 · 답장은 확인하지 않아요";

    private final ReconstructionJobRepository jobRepository;
    private final UserRepository userRepository;
    private final MattermostProperties properties;
    private final RestClient restClient;

    public MattermostReconNotifier(
            ReconstructionJobRepository jobRepository,
            UserRepository userRepository,
            MattermostProperties properties) {
        this.jobRepository = jobRepository;
        this.userRepository = userRepository;
        this.properties = properties;
        HttpClient httpClient =
                HttpClient.newBuilder().connectTimeout(properties.timeout()).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(properties.timeout());
        this.restClient = RestClient.builder().requestFactory(factory).build();
    }

    /** 커밋된 뒤에 부른다. 꺼져 있거나, 탈퇴했거나, 아이디를 등록하지 않았으면 보내지 않는다. */
    public void reconFailed(String jobId) {
        if (!properties.enabled()) {
            return;
        }
        try {
            String username =
                    jobRepository
                            .findById(jobId)
                            .map(ReconstructionJob::getUserId)
                            .flatMap(userRepository::findById)
                            .filter(User::isActive)
                            .map(User::getMattermostUsername)
                            .orElse(null);
            if (username == null) {
                return;
            }
            post(payload(username, message(jobId)));
        } catch (RestClientResponseException e) {
            log.warn("mattermost recon notify status={}", e.getStatusCode().value());
        } catch (RuntimeException e) {
            log.warn("mattermost recon notify failed: {}", e.getClass().getSimpleName());
        }
    }

    void post(Map<String, String> payload) {
        restClient
                .post()
                .uri(properties.webhookUrl())
                .contentType(MediaType.APPLICATION_JSON)
                .body(payload)
                .retrieve()
                .toBodilessEntity();
    }

    String message(String jobId) {
        NotificationType type = NotificationType.RECON_FAILED;
        String text = "#### ⚠️ " + type.title() + "\n" + type.body();
        if (properties.webBaseUrl().isEmpty()) {
            return text;
        }
        String id = URLEncoder.encode(jobId, StandardCharsets.UTF_8);
        return text
                + "\n\n**[→ 이유 보기]("
                + properties.webBaseUrl()
                + "/reconstructions/"
                + id
                + ")**";
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
