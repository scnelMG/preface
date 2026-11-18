package com.preface.api.auth.service;

import com.preface.api.auth.dto.IssuedSession;
import com.preface.api.auth.dto.UserSummary;
import com.preface.api.global.security.AuthProperties;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import com.preface.common.user.entity.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** 일반 세션 발급: access token(JWT, 30분) + refresh token(Redis, 회전). */
@Component
@RequiredArgsConstructor
class SessionIssuer {

    private final JwtProvider jwtProvider;
    private final AuthProperties properties;
    private final RefreshTokenStore refreshTokenStore;

    IssuedSession issue(User user) {
        JwtProvider.IssuedToken access =
                jwtProvider.issue(user.getId(), TokenScope.USER, properties.accessTokenTtl());
        String refresh = refreshTokenStore.issue(user.getId());
        return new IssuedSession(
                access.value(),
                access.expiresInSeconds(),
                refresh,
                new UserSummary(user.getId(), user.getNickname()));
    }
}
