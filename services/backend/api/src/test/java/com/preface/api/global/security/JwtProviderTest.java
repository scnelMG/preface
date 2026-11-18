package com.preface.api.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class JwtProviderTest {

    private static final String SECRET = "unit-test-only-signing-key-not-a-real-secret";
    private static final Instant NOW = Instant.parse("2026-10-23T00:00:00Z");

    private final JwtProvider provider = provider(SECRET, NOW);

    @Test
    void 발급한_토큰을_검증하면_subject와_scope가_나온다() {
        String token = provider.issue("user-1", TokenScope.USER, Duration.ofMinutes(30)).value();

        AuthPrincipal principal = provider.parse(token);

        assertThat(principal.subject()).isEqualTo("user-1");
        assertThat(principal.scope()).isEqualTo(TokenScope.USER);
    }

    @Test
    void 업로드_전용_세션_토큰은_QR_링크_ID를_담는다() {
        String token = provider.issueCapture("user-1", "link-1", Duration.ofMinutes(30)).value();

        AuthPrincipal principal = provider.parse(token);

        assertThat(principal.subject()).isEqualTo("user-1");
        assertThat(principal.scope()).isEqualTo(TokenScope.CAPTURE);
        assertThat(principal.captureLinkId()).isEqualTo("link-1");
    }

    @Test
    void 링크_ID가_없는_capture_토큰은_위조로_거절한다() {
        String token = provider.issue("user-1", TokenScope.CAPTURE, Duration.ofMinutes(30)).value();

        assertThatThrownBy(() -> provider.parse(token))
                .isInstanceOf(JwtProvider.InvalidTokenException.class);
    }

    @Test
    void 만료된_토큰은_expired로_구분된다() {
        String token = provider.issue("user-1", TokenScope.USER, Duration.ofMinutes(30)).value();
        JwtProvider later = provider(SECRET, NOW.plus(Duration.ofMinutes(31)));

        assertThatThrownBy(() -> later.parse(token))
                .isInstanceOfSatisfying(
                        JwtProvider.InvalidTokenException.class,
                        e -> assertThat(e.expired()).isTrue());
    }

    @Test
    void 다른_키로_서명한_토큰은_위조로_거절한다() {
        String token =
                provider("another-unit-test-key-that-is-long-enough!!", NOW)
                        .issue("user-1", TokenScope.USER, Duration.ofMinutes(30))
                        .value();

        assertThatThrownBy(() -> provider.parse(token))
                .isInstanceOfSatisfying(
                        JwtProvider.InvalidTokenException.class,
                        e -> assertThat(e.expired()).isFalse());
    }

    @Test
    void 형식이_틀린_문자열은_위조로_거절한다() {
        assertThatThrownBy(() -> provider.parse("not-a-jwt"))
                .isInstanceOf(JwtProvider.InvalidTokenException.class);
    }

    @Test
    void 키가_32바이트보다_짧으면_시작하지_않는다() {
        assertThatThrownBy(() -> provider("short", NOW)).isInstanceOf(IllegalStateException.class);
    }

    private static JwtProvider provider(String secret, Instant now) {
        AuthProperties properties =
                new AuthProperties(
                        secret,
                        Duration.ofMinutes(30),
                        Duration.ofMinutes(10),
                        Duration.ofDays(14),
                        List.of(),
                        true,
                        null,
                        null,
                        null);
        return new JwtProvider(properties, Clock.fixed(now, ZoneOffset.UTC));
    }
}
