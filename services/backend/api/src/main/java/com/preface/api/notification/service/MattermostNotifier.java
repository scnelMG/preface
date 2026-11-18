package com.preface.api.notification.service;

import com.preface.common.notification.entity.NotificationTargetKind;
import com.preface.common.notification.entity.NotificationType;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 3D 생성 결과를 등록된 Mattermost 아이디로도 알린다(S15P31B204-476).
 *
 * <p>작업을 끝내는 트랜잭션이 커밋된 뒤에만, 별도 스레드에서 보낸다. 롤백된 결과를 알리지 않고, Mattermost가 느리거나 실패해도 작업 상태·인앱 알림에는 영향이
 * 없다(실패는 로그만). 내용은 서버 고정 문구와 링크뿐이다(이름·사진·수치 없음).
 */
@Slf4j
@Component
class MattermostNotifier {

    private final UserRepository userRepository;
    private final MattermostWebhookClient webhook;
    private final MattermostProperties properties;
    private final TaskExecutor executor;

    MattermostNotifier(
            UserRepository userRepository,
            MattermostWebhookClient webhook,
            MattermostProperties properties,
            @Qualifier("mattermostExecutor") TaskExecutor executor) {
        this.userRepository = userRepository;
        this.webhook = webhook;
        this.properties = properties;
        this.executor = executor;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void onReconNotified(ReconNotifiedEvent event) {
        if (!webhook.enabled()) {
            return;
        }
        try {
            executor.execute(() -> send(event));
        } catch (TaskRejectedException e) {
            // 커밋 뒤 콜백이 던지면 이미 커밋된 결과 보고가 호출자에게 실패로 보인다. 알림 1건을 버린다
            log.warn("mattermost recon notify dropped: executor busy");
        }
    }

    void send(ReconNotifiedEvent event) {
        try {
            String username =
                    userRepository
                            .findById(event.userId())
                            .filter(User::isActive)
                            .map(User::getMattermostUsername)
                            .orElse(null);
            if (username == null) {
                return;
            }
            MattermostWebhookClient.Result result = webhook.sendDirect(username, message(event));
            if (result != MattermostWebhookClient.Result.SENT) {
                log.warn("mattermost recon notify {} type={}", result, event.type());
            }
        } catch (RuntimeException e) {
            log.warn("mattermost recon notify failed: {}", e.getClass().getSimpleName());
        }
    }

    /** 상태 이모지 + 작은 제목, 본문, 굵은 링크(S15P31B204-532). 제목·본문은 앱 알림과 같은 고정 문구다. */
    String message(ReconNotifiedEvent event) {
        boolean succeeded = event.type() == NotificationType.RECON_SUCCEEDED;
        String text =
                "#### "
                        + (succeeded ? "✅ " : "⚠️ ")
                        + event.type().title()
                        + "\n"
                        + event.type().body();
        String link = link(event);
        if (link == null) {
            return text;
        }
        return text + "\n\n**[" + (succeeded ? "→ Preface에서 보기" : "→ 이유 보기") + "](" + link + ")**";
    }

    /** FE 알림 이동과 같은 주소(apps/web features/notifications/links.ts). */
    private String link(ReconNotifiedEvent event) {
        if (properties.webBaseUrl().isEmpty() || event.targetId() == null) {
            return null;
        }
        String id = URLEncoder.encode(event.targetId(), StandardCharsets.UTF_8);
        NotificationTargetKind kind = event.type().targetKind();
        return switch (kind) {
            case FACE_MODEL -> properties.webBaseUrl() + "/studio?faceModelId=" + id;
            case RECON_JOB -> properties.webBaseUrl() + "/reconstructions/" + id;
        };
    }
}
