package com.preface.api.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.notification.dto.MattermostCodeResponse;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ErrorCode;
import com.preface.common.error.NotificationErrorCode;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class MattermostLinkServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-30T05:00:00Z");

    private final UserRepository userRepository = mock(UserRepository.class);
    private final MattermostVerificationStore store = mock(MattermostVerificationStore.class);
    private final MattermostWebhookClient webhook = mock(MattermostWebhookClient.class);
    private final MattermostProperties properties =
            new MattermostProperties(
                    "https://mm.example/hooks/x",
                    "https://web.example",
                    Duration.ofMinutes(10),
                    Duration.ofSeconds(60),
                    5,
                    Duration.ofSeconds(3));
    private final MattermostLinkService service =
            new MattermostLinkService(
                    userRepository, store, webhook, properties, Clock.fixed(NOW, ZoneOffset.UTC));
    private final User user = User.join("합성", "user@example.com");

    @BeforeEach
    void setUp() {
        when(userRepository.findById("u1")).thenReturn(Optional.of(user));
        when(webhook.enabled()).thenReturn(true);
        when(store.tryReserveSend(eq("u1"), any())).thenReturn(true);
    }

    @Test
    void 아이디로_확인_코드를_DM으로_보내고_해시만_저장한다() {
        when(webhook.sendDirect(eq("hong.gildong"), anyString()))
                .thenReturn(MattermostWebhookClient.Result.SENT);

        MattermostCodeResponse response = service.requestCode("u1", " @Hong.Gildong ");

        ArgumentCaptor<String> text = ArgumentCaptor.forClass(String.class);
        verify(webhook).sendDirect(eq("hong.gildong"), text.capture());
        assertThat(text.getValue()).startsWith("#### 🔐 Mattermost 알림 확인 코드\n## `");
        String code = text.getValue().replaceAll("(?s).*## `(\\d{6})`.*", "$1");
        assertThat(code).matches("\\d{6}");
        verify(store)
                .save(
                        "u1",
                        "hong.gildong",
                        MattermostLinkService.hash(code),
                        Duration.ofMinutes(10));
        assertThat(response.username()).isEqualTo("hong.gildong");
        assertThat(response.expiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(10)));
        assertThat(response.resendAvailableAt()).isEqualTo(NOW.plusSeconds(60));
    }

    @Test
    void 없는_아이디면_NOTI_002이고_바로_다시_시도할_수_있다() {
        when(webhook.sendDirect(anyString(), anyString()))
                .thenReturn(MattermostWebhookClient.Result.REJECTED);

        assertCode(
                () -> service.requestCode("u1", "nobody"),
                NotificationErrorCode.MATTERMOST_USER_NOT_FOUND);
        verify(store).releaseSend("u1");
        verify(store, never()).save(anyString(), anyString(), anyString(), any());
    }

    @Test
    void 간격_안에_다시_받으면_COMMON_003이고_DM을_보내지_않는다() {
        when(store.tryReserveSend(eq("u1"), any())).thenReturn(false);

        assertCode(() -> service.requestCode("u1", "hong"), CommonErrorCode.TOO_MANY_REQUESTS);
        verify(webhook, never()).sendDirect(anyString(), anyString());
    }

    @Test
    void webhook이_설정되지_않았으면_NOTI_001() {
        when(webhook.enabled()).thenReturn(false);

        assertCode(
                () -> service.requestCode("u1", "hong"), NotificationErrorCode.MATTERMOST_DISABLED);
    }

    @Test
    void 아이디_형식이_아니면_COMMON_001() {
        for (String bad : new String[] {"", "ab", "1abc", "한글아이디", "a b", "a".repeat(23)}) {
            assertCode(() -> MattermostLinkService.normalize(bad), CommonErrorCode.INVALID_REQUEST);
        }
        assertThat(MattermostLinkService.normalize("s2ndn1s")).isEqualTo("s2ndn1s");
    }

    @Test
    void 코드가_맞으면_아이디를_등록하고_확인_정보를_지운다() {
        when(store.find("u1"))
                .thenReturn(
                        Optional.of(
                                new MattermostVerificationStore.Pending(
                                        "hong", MattermostLinkService.hash("123456"))));

        var response = service.confirm("u1", " 123456 ");

        assertThat(user.getMattermostUsername()).isEqualTo("hong");
        assertThat(user.getMattermostLinkedAt()).isEqualTo(NOW);
        assertThat(response.username()).isEqualTo("hong");
        verify(store).delete("u1");
    }

    @Test
    void 코드가_틀리면_NOTI_003이고_정해진_횟수를_넘으면_코드를_버린다() {
        when(store.find("u1"))
                .thenReturn(
                        Optional.of(
                                new MattermostVerificationStore.Pending(
                                        "hong", MattermostLinkService.hash("123456"))));
        when(store.incrementAttempts("u1")).thenReturn(1L, 5L);

        assertCode(
                () -> service.confirm("u1", "000000"),
                NotificationErrorCode.VERIFICATION_CODE_MISMATCH);
        assertCode(
                () -> service.confirm("u1", "000000"), NotificationErrorCode.VERIFICATION_EXPIRED);
        verify(store).delete("u1");
        assertThat(user.getMattermostUsername()).isNull();
    }

    @Test
    void 확인_중인_코드가_없으면_NOTI_004() {
        when(store.find("u1")).thenReturn(Optional.empty());

        assertCode(
                () -> service.confirm("u1", "123456"), NotificationErrorCode.VERIFICATION_EXPIRED);
    }

    @Test
    void 알림을_끄면_아이디와_동의_시각을_지운다() {
        user.linkMattermost("hong", NOW);

        service.unlink("u1");

        assertThat(user.getMattermostUsername()).isNull();
        assertThat(user.getMattermostLinkedAt()).isNull();
        verify(store).delete("u1");
    }

    @Test
    void 탈퇴하면_Mattermost_아이디도_지운다() {
        user.linkMattermost("hong", NOW);

        user.withdraw(NOW);

        assertThat(user.getMattermostUsername()).isNull();
        assertThat(user.getMattermostLinkedAt()).isNull();
    }

    private static void assertCode(Runnable call, ErrorCode code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        BusinessException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
    }
}
