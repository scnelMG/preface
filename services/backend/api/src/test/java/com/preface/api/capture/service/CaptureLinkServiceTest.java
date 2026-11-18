package com.preface.api.capture.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.capture.dto.CaptureLinkResponse;
import com.preface.api.capture.dto.CaptureLinkStatus;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.api.global.security.AuthProperties;
import com.preface.api.global.security.CaptureSessionRevocations;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CaptureErrorCode;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ErrorCode;
import com.preface.common.user.repository.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Redis 동작(Lua)은 CaptureFlowIT가 본다. 여기서는 권한·에러 매핑·토큰 노출 규칙만 본다. */
class CaptureLinkServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-23T00:00:00Z");
    private static final String USER_ID = "00000000-0000-0000-0000-000000000003";
    private static final String LINK_ID = "00000000-0000-0000-0000-0000000000aa";

    private final CaptureLinkStore store = mock(CaptureLinkStore.class);
    private final CaptureSessionRevocations revocations = mock(CaptureSessionRevocations.class);
    private final CaptureProperties properties =
            new CaptureProperties(
                    "https://preface.test/", Duration.ofSeconds(180), Duration.ofMinutes(30));
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final CaptureLinkService service =
            new CaptureLinkService(
                    mock(CaptureGuard.class),
                    store,
                    revocations,
                    properties,
                    new JwtProvider(
                            new AuthProperties(
                                    "unit-test-only-signing-key-not-a-real-secret",
                                    Duration.ofMinutes(30),
                                    Duration.ofMinutes(10),
                                    Duration.ofDays(14),
                                    List.of(),
                                    true,
                                    null,
                                    null,
                                    null),
                            clock),
                    mock(UserRepository.class),
                    clock);

    @Test
    void QR_URL은_토큰을_fragment에_넣고_저장소에는_토큰_해시만_넘긴다() {
        CaptureLinkResponse response = service.create(USER_ID);

        assertThat(response.qrUrl()).startsWith("https://preface.test/m/capture#t=");
        String token = response.qrUrl().substring(response.qrUrl().indexOf("#t=") + 3);
        assertThat(token).hasSizeGreaterThanOrEqualTo(43);
        assertThat(response.expiresAt()).isEqualTo(NOW.plusSeconds(180));
        assertThat(response.toString()).doesNotContain(token);

        ArgumentCaptor<String> hash = ArgumentCaptor.forClass(String.class);
        verify(store)
                .create(
                        eq(response.linkId()),
                        eq(USER_ID),
                        hash.capture(),
                        eq(NOW.plusSeconds(180)),
                        eq(Duration.ofSeconds(180)),
                        eq(Duration.ofMinutes(30)));
        assertThat(hash.getValue()).hasSize(64).isNotEqualTo(token);
    }

    @Test
    void 새_QR을_만들면_이전_링크는_EXPIRED가_되고_그_휴대폰_세션은_폐기된다() {
        when(store.currentLinkIdOf(USER_ID)).thenReturn(Optional.of(LINK_ID));
        when(store.find(LINK_ID)).thenReturn(Optional.of(link(CaptureLinkStatus.CONNECTED)));

        service.create(USER_ID);

        verify(store)
                .transition(
                        eq("hash"),
                        eq(CaptureLinkStatus.EXPIRED),
                        eq(null),
                        any(CaptureLinkStatus[].class));
        verify(revocations).revoke(LINK_ID, Duration.ofMinutes(30));
    }

    @Test
    void 이미_연결된_토큰은_QR_002_만료되거나_없는_토큰은_QR_001() {
        when(store.exchange(anyString(), any(), any()))
                .thenReturn(
                        new CaptureLinkStore.ExchangeResult(
                                false, CaptureLinkStatus.CONNECTED, LINK_ID, USER_ID));
        assertError(
                () -> service.exchange("synthetic-token"), CaptureErrorCode.LINK_ALREADY_CONNECTED);

        when(store.exchange(anyString(), any(), any()))
                .thenReturn(
                        new CaptureLinkStore.ExchangeResult(
                                false, CaptureLinkStatus.EXPIRED, "", ""));
        assertError(() -> service.exchange("synthetic-token"), CaptureErrorCode.LINK_EXPIRED);

        when(store.exchange(anyString(), any(), any()))
                .thenReturn(
                        new CaptureLinkStore.ExchangeResult(
                                false, CaptureLinkStatus.CANCELED, LINK_ID, USER_ID));
        assertError(() -> service.exchange("synthetic-token"), CaptureErrorCode.LINK_EXPIRED);
    }

    @Test
    void 다른_링크의_업로드_세션이나_다른_회원은_연결을_끊을_수_없다() {
        when(store.find(LINK_ID)).thenReturn(Optional.of(link(CaptureLinkStatus.CONNECTED)));

        assertError(
                () ->
                        service.cancel(
                                new AuthPrincipal(USER_ID, TokenScope.CAPTURE, "other-link"),
                                LINK_ID),
                CommonErrorCode.NOT_FOUND);
        assertError(
                () -> service.cancel(new AuthPrincipal("someone-else", TokenScope.USER), LINK_ID),
                CommonErrorCode.NOT_FOUND);
        verify(revocations, never()).revoke(anyString(), any());
    }

    @Test
    void 자기_링크의_업로드_세션은_연결을_끊을_수_있고_세션이_폐기된다() {
        when(store.find(LINK_ID)).thenReturn(Optional.of(link(CaptureLinkStatus.CONNECTED)));

        service.cancel(new AuthPrincipal(USER_ID, TokenScope.CAPTURE, LINK_ID), LINK_ID);

        verify(store)
                .transition(
                        eq("hash"),
                        eq(CaptureLinkStatus.CANCELED),
                        eq(null),
                        any(CaptureLinkStatus[].class));
        verify(revocations).revoke(LINK_ID, Duration.ofMinutes(30));
    }

    @Test
    void 남의_링크_상태는_404로_숨긴다() {
        when(store.find(LINK_ID)).thenReturn(Optional.of(link(CaptureLinkStatus.WAITING)));

        assertError(() -> service.status("someone-else", LINK_ID), CommonErrorCode.NOT_FOUND);
        assertThat(service.status(USER_ID, LINK_ID).status()).isEqualTo(CaptureLinkStatus.WAITING);
    }

    private static CaptureLinkStore.Link link(CaptureLinkStatus status) {
        return new CaptureLinkStore.Link(
                LINK_ID, USER_ID, "hash", status, NOW.plusSeconds(180), null);
    }

    private static void assertError(Runnable call, ErrorCode code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        BusinessException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
    }
}
