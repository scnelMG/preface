package com.preface.api.auth.dto;

/** 서비스 → 컨트롤러 전달용. refreshToken은 컨트롤러가 HttpOnly 쿠키로만 내보낸다(본문 금지). */
public record IssuedSession(
        String accessToken, long expiresIn, String refreshToken, UserSummary user) {}
