package com.preface.api.auth.controller;

import com.preface.api.global.security.AuthProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * refresh token 쿠키: {@code HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth}.
 *
 * <ul>
 *   <li>HttpOnly: JS(XSS)가 읽지 못한다. 그래서 refresh는 응답 본문에 넣지 않는다.
 *   <li>SameSite=Strict: 다른 사이트에서 보낸 요청에는 쿠키가 붙지 않는다(CSRF 방지). FE와 API가 같은 사이트(등록 도메인)여야 한다.
 *   <li>Path: 인증 API에만 붙는다. 다른 API 요청마다 쿠키가 따라가지 않는다.
 *   <li>이름: {@code preface.auth.refresh-cookie-name}(기본 {@code refresh_token}). 쿠키는 포트를 구분하지 않아
 *       운영·개발이 같은 이름이면 서로 덮어쓴다.
 * </ul>
 */
@Component
@RequiredArgsConstructor
class RefreshCookies {

    private static final String PATH = "/api/v1/auth";

    private final AuthProperties properties;

    ResponseCookie issue(String token) {
        return base(token).maxAge(properties.refreshTokenTtl()).build();
    }

    /** 요청에 실린 refresh 쿠키 값. 없으면 null(서비스가 AUTH 에러로 처리한다). */
    String read(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (properties.refreshCookieName().equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    ResponseCookie expire() {
        return base("").maxAge(Duration.ZERO).build();
    }

    private ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(properties.refreshCookieName(), value)
                .httpOnly(true)
                .secure(properties.refreshCookieSecure())
                .sameSite("Strict")
                .path(PATH);
    }
}
