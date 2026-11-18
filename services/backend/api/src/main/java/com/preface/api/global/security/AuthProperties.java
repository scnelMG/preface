package com.preface.api.global.security;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 인증 설정({@code preface.auth.*}). 비밀값(JWT 키, OAuth client secret)은 환경 변수로만 받는다.
 *
 * @param jwtSecret HS256 서명 키. 32바이트 이상
 * @param allowedRedirectUris 소셜 로그인 후 돌아갈 FE 주소 허용 목록(AUTH_011)
 * @param refreshCookieSecure refresh 쿠키 Secure 속성. 로컬 http 테스트 외에는 끄지 않는다
 * @param refreshCookieName refresh 쿠키 이름. 쿠키는 포트를 구분하지 않으니 같은 도메인의 운영(443)·개발(8080)은 이름을 달리한다
 */
@ConfigurationProperties("preface.auth")
public record AuthProperties(
        String jwtSecret,
        Duration accessTokenTtl,
        Duration signupTokenTtl,
        Duration refreshTokenTtl,
        List<String> allowedRedirectUris,
        boolean refreshCookieSecure,
        String refreshCookieName,
        Provider kakao,
        Provider google) {

    public static final String DEFAULT_REFRESH_COOKIE_NAME = "refresh_token";

    public AuthProperties {
        allowedRedirectUris =
                allowedRedirectUris == null ? List.of() : List.copyOf(allowedRedirectUris);
        kakao = kakao == null ? new Provider("", "") : kakao;
        google = google == null ? new Provider("", "") : google;
        refreshCookieName =
                refreshCookieName == null || refreshCookieName.isBlank()
                        ? DEFAULT_REFRESH_COOKIE_NAME
                        : refreshCookieName;
    }

    public record Provider(String clientId, String clientSecret) {

        public boolean configured() {
            return clientId != null && !clientId.isBlank();
        }
    }
}
