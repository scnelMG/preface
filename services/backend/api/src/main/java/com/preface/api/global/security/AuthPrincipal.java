package com.preface.api.global.security;

/**
 * 검증된 토큰의 주인. 컨트롤러에서 {@code @AuthenticationPrincipal AuthPrincipal}로 받는다.
 *
 * @param subject {@code user}·{@code capture}면 회원 ID, {@code signup}이면 가입 대기 ID
 * @param captureLinkId {@code capture}(업로드 전용 세션)일 때 그 세션을 만든 QR 링크 ID. 그 외 {@code null}
 */
public record AuthPrincipal(String subject, TokenScope scope, String captureLinkId) {

    public AuthPrincipal(String subject, TokenScope scope) {
        this(subject, scope, null);
    }
}
