package com.preface.api.global.security;

import java.time.Duration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * 탈퇴한 회원 목록. Redis {@code auth:withdrawn:{userId}}.
 *
 * <p>access token(JWT)은 서버에 저장하지 않아 탈퇴해도 만료 전까지 서명이 유효하다. 그래서 탈퇴 때 여기에 회원 ID를 올리고, {@link
 * JwtAuthenticationFilter}가 매 요청 확인해 AUTH_001로 거절한다. 업로드 전용 세션({@code scope=capture})도 subject가 회원
 * ID라 함께 막힌다. {@link CaptureSessionRevocations}와 같은 방식이다.
 *
 * <p>TTL은 refresh token 수명으로 건다. 회원 ID로 발급된 어떤 토큰(access 30분, 업로드 전용 세션 30분)보다 길어서 설정값이 바뀌어도 빈틈이
 * 없고, 탈퇴 회원당 키 하나라 비용은 작다.
 */
@Component
public class WithdrawnUsers {

    private static final String PREFIX = "auth:withdrawn:";

    private final StringRedisTemplate redis;
    private final Duration ttl;

    public WithdrawnUsers(StringRedisTemplate redis, AuthProperties properties) {
        this.redis = redis;
        this.ttl = properties.refreshTokenTtl();
    }

    public void add(String userId) {
        redis.opsForValue().set(PREFIX + userId, "1", ttl);
    }

    public boolean contains(String userId) {
        return Boolean.TRUE.equals(redis.hasKey(PREFIX + userId));
    }
}
