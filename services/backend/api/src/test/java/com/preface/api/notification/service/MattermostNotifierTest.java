package com.preface.api.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.common.notification.entity.NotificationType;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskRejectedException;

class MattermostNotifierTest {

    private final UserRepository userRepository = mock(UserRepository.class);
    private final MattermostWebhookClient webhook = mock(MattermostWebhookClient.class);

    private MattermostNotifier notifier(String webBaseUrl) {
        MattermostProperties properties =
                new MattermostProperties(
                        "https://mm.example/hooks/x",
                        webBaseUrl,
                        null,
                        null,
                        0,
                        Duration.ofSeconds(3));
        // 테스트는 같은 스레드에서 바로 실행한다
        return new MattermostNotifier(userRepository, webhook, properties, Runnable::run);
    }

    @Test
    void 등록한_사용자에게_성공_알림을_작업실_링크와_함께_보낸다() {
        User user = User.join("합성", null);
        user.linkMattermost("hong", Instant.EPOCH);
        when(userRepository.findById("u1")).thenReturn(Optional.of(user));
        when(webhook.enabled()).thenReturn(true);

        notifier("https://web.example/")
                .onReconNotified(
                        new ReconNotifiedEvent("u1", NotificationType.RECON_SUCCEEDED, "fm-1"));

        verify(webhook)
                .sendDirect(
                        "hong",
                        "#### ✅ 원본 3D가 생성됐어요\n작업실에서 확인해 보세요.\n\n"
                                + "**[→ Preface에서 보기](https://web.example/studio?faceModelId=fm-1)**");
    }

    @Test
    void 실패_알림은_복원_작업_화면으로_보내고_FE_주소가_없으면_링크를_뺀다() {
        MattermostNotifier withLink = notifier("https://web.example");
        MattermostNotifier withoutLink = notifier("");
        ReconNotifiedEvent event =
                new ReconNotifiedEvent("u1", NotificationType.RECON_FAILED, "job-1");

        assertThat(withLink.message(event))
                .startsWith("#### ⚠️ 3D를 만들지 못했어요\n")
                .endsWith("**[→ 이유 보기](https://web.example/reconstructions/job-1)**");
        assertThat(withoutLink.message(event)).doesNotContain("http");
    }

    @Test
    void 등록하지_않은_사용자에게는_보내지_않는다() {
        when(userRepository.findById("u1")).thenReturn(Optional.of(User.join("합성", null)));
        when(webhook.enabled()).thenReturn(true);

        notifier("https://web.example")
                .onReconNotified(
                        new ReconNotifiedEvent("u1", NotificationType.RECON_SUCCEEDED, "fm-1"));

        verify(webhook, never()).sendDirect(anyString(), anyString());
    }

    @Test
    void 전송_풀이_가득_차도_커밋_뒤_콜백이_예외를_던지지_않는다() {
        when(webhook.enabled()).thenReturn(true);
        MattermostProperties properties =
                new MattermostProperties(
                        "https://mm.example/hooks/x", "", null, null, 0, Duration.ofSeconds(3));
        MattermostNotifier busy =
                new MattermostNotifier(
                        userRepository,
                        webhook,
                        properties,
                        task -> {
                            throw new TaskRejectedException("full");
                        });

        assertThatCode(
                        () ->
                                busy.onReconNotified(
                                        new ReconNotifiedEvent(
                                                "u1", NotificationType.RECON_FAILED, "job-1")))
                .doesNotThrowAnyException();
        verify(webhook, never()).sendDirect(anyString(), anyString());
    }

    @Test
    void 전송_중_예외가_나도_밖으로_던지지_않는다() {
        when(userRepository.findById("u1")).thenThrow(new IllegalStateException("db down"));
        when(webhook.enabled()).thenReturn(true);

        notifier("https://web.example")
                .send(new ReconNotifiedEvent("u1", NotificationType.RECON_FAILED, "job-1"));

        verify(webhook, never()).sendDirect(anyString(), anyString());
    }
}
