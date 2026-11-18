package com.preface.api.auth.service;

import com.preface.common.user.entity.OAuthProvider;
import java.time.Duration;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * 소셜 로그인 {@code state}(CSRF 방지). Redis {@code auth:state:{state}} = "PROVIDER redirectUri", 5분.
 *
 * <p>꺼낼 때 지운다(GETDEL). 같은 state로 두 번 로그인할 수 없다.
 */
@Component
@RequiredArgsConstructor
class OAuthStateStore {

    private static final Duration TTL = Duration.ofMinutes(5);
    private static final String PREFIX = "auth:state:";

    private final StringRedisTemplate redis;

    void save(String state, OAuthProvider provider, String redirectUri) {
        redis.opsForValue().set(PREFIX + state, provider.name() + " " + redirectUri, TTL);
    }

    /** state가 있고 provider·redirectUri가 발급 때와 같으면 true. 결과와 관계없이 state는 소모된다. */
    boolean consume(String state, OAuthProvider provider, String redirectUri) {
        return Optional.ofNullable(redis.opsForValue().getAndDelete(PREFIX + state))
                .map(saved -> saved.equals(provider.name() + " " + redirectUri))
                .orElse(false);
    }
}
