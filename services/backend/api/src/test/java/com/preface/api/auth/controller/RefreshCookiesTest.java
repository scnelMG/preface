package com.preface.api.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.global.security.AuthProperties;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseCookie;
import org.springframework.mock.web.MockHttpServletRequest;

class RefreshCookiesTest {

    private static RefreshCookies cookies(String name) {
        return new RefreshCookies(
                new AuthProperties(
                        "unit-test-only-signing-key-not-a-real-secret",
                        Duration.ofMinutes(30),
                        Duration.ofMinutes(10),
                        Duration.ofDays(14),
                        List.of(),
                        true,
                        name,
                        null,
                        null));
    }

    @Test
    void 이름을_설정하지_않으면_refresh_token으로_발급한다() {
        ResponseCookie cookie = cookies(null).issue("token-value");

        assertThat(cookie.getName()).isEqualTo("refresh_token");
        assertThat(cookie.isHttpOnly()).isTrue();
        assertThat(cookie.getPath()).isEqualTo("/api/v1/auth");
    }

    @Test
    void 설정한_이름으로_발급하고_만료시킨다() {
        RefreshCookies refreshCookies = cookies("refresh_token_dev");

        assertThat(refreshCookies.issue("token-value").getName()).isEqualTo("refresh_token_dev");
        assertThat(refreshCookies.expire().getName()).isEqualTo("refresh_token_dev");
        assertThat(refreshCookies.expire().getMaxAge()).isEqualTo(Duration.ZERO);
    }

    @Test
    void 설정한_이름의_쿠키만_읽고_다른_환경의_쿠키는_무시한다() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(
                new Cookie("refresh_token", "prod-token"),
                new Cookie("refresh_token_dev", "dev-token"));

        assertThat(cookies("refresh_token_dev").read(request)).isEqualTo("dev-token");
        assertThat(cookies(null).read(request)).isEqualTo("prod-token");
    }

    @Test
    void 쿠키가_없으면_null이다() {
        assertThat(cookies(null).read(new MockHttpServletRequest())).isNull();
    }
}
