package com.preface.api.auth.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/** API-AUTH-02 응답. 기존 회원이면 세션 필드만, 신규 사용자면 가입 토큰 필드만 채운다(빈 필드는 내보내지 않는다). */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record LoginResponse(
        boolean isNewUser,
        String accessToken,
        Long expiresIn,
        UserSummary user,
        String signupToken,
        Long signupExpiresIn,
        SignupProfile profile) {

    public static LoginResponse existing(String accessToken, long expiresIn, UserSummary user) {
        return new LoginResponse(false, accessToken, expiresIn, user, null, null, null);
    }

    public static LoginResponse newUser(String signupToken, long expiresIn, SignupProfile profile) {
        return new LoginResponse(true, null, null, null, signupToken, expiresIn, profile);
    }
}
