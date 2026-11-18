package com.preface.common.user.entity;

import java.util.Arrays;
import java.util.Optional;

/** 소셜 로그인 제공자. DB 값은 대문자(KAKAO), API path 값은 소문자(kakao)다. */
public enum OAuthProvider {
    KAKAO,
    GOOGLE;

    public static Optional<OAuthProvider> fromPath(String value) {
        return Arrays.stream(values()).filter(p -> p.pathValue().equals(value)).findFirst();
    }

    public String pathValue() {
        return name().toLowerCase();
    }
}
