package com.preface.api.global.security;

import java.util.Arrays;
import java.util.Optional;

/**
 * 토큰 종류(JWT {@code scope} 클레임). API 명세서 "토큰 종류".
 *
 * <ul>
 *   <li>{@code user} 일반 세션
 *   <li>{@code signup} 가입 토큰: 동의서 조회·가입 완료만 허용
 *   <li>{@code capture} 휴대폰 업로드 전용 세션(QR 기능에서 발급)
 * </ul>
 */
public enum TokenScope {
    USER("user"),
    SIGNUP("signup"),
    CAPTURE("capture");

    private final String value;

    TokenScope(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    /** Spring Security 권한 이름. {@code hasAuthority("SCOPE_user")}로 검사한다. */
    public String authority() {
        return "SCOPE_" + value;
    }

    public static Optional<TokenScope> from(String value) {
        return Arrays.stream(values()).filter(s -> s.value.equals(value)).findFirst();
    }
}
