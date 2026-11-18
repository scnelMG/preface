package com.preface.api.auth.service;

import com.preface.api.global.security.AuthProperties;
import com.preface.api.global.security.TokenHashes;
import java.util.Optional;
import java.util.Set;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * refresh token(불투명 난수). Redis {@code auth:refresh:{sha256(token)}} = userId.
 *
 * <p>JWT가 아니라 난수인 이유: 로그아웃·탈퇴 때 즉시 폐기해야 하는데, 서버 저장소를 어차피 봐야 한다면 서명 검증까지 할 필요가 없다.
 *
 * <p>재발급 때마다 회전한다. 꺼낼 때 지우므로(GETDEL) 같은 refresh는 한 번만 쓸 수 있다.
 *
 * <p>탈퇴 때는 refresh 원문이 없다(쿠키 Path가 {@code /api/v1/auth}라 {@code DELETE /users/me}에는 오지 않는다). 그래서
 * 회원별 색인 {@code auth:refresh-user:{userId}}(SET, 토큰 해시 목록)을 함께 두고 {@link #revokeAll}이 그 목록으로 지운다.
 * 색인 TTL은 발급할 때마다 refresh 수명으로 다시 건다.
 */
@Component
class RefreshTokenStore {

    private static final String PREFIX = "auth:refresh:";
    private static final String USER_INDEX_PREFIX = "auth:refresh-user:";

    private final StringRedisTemplate redis;
    private final AuthProperties properties;

    RefreshTokenStore(StringRedisTemplate redis, AuthProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    String issue(String userId) {
        String token = TokenHashes.newOpaqueToken();
        String hash = TokenHashes.sha256Hex(token);
        redis.opsForValue().set(PREFIX + hash, userId, properties.refreshTokenTtl());
        redis.opsForSet().add(USER_INDEX_PREFIX + userId, hash);
        redis.expire(USER_INDEX_PREFIX + userId, properties.refreshTokenTtl());
        return token;
    }

    /** 유효하면 userId를 돌려주고 그 토큰은 폐기한다. */
    Optional<String> consume(String token) {
        String hash = TokenHashes.sha256Hex(token);
        Optional<String> userId =
                Optional.ofNullable(redis.opsForValue().getAndDelete(PREFIX + hash));
        userId.ifPresent(id -> redis.opsForSet().remove(USER_INDEX_PREFIX + id, hash));
        return userId;
    }

    void revoke(String token) {
        redis.delete(PREFIX + TokenHashes.sha256Hex(token));
    }

    /** 이 회원의 refresh를 모두 폐기한다(탈퇴). 색인 도입 전에 발급된 refresh는 남을 수 있지만 재발급이 탈퇴 회원을 AUTH_003으로 막는다. */
    void revokeAll(String userId) {
        String index = USER_INDEX_PREFIX + userId;
        Set<String> hashes = redis.opsForSet().members(index);
        if (hashes != null && !hashes.isEmpty()) {
            redis.delete(hashes.stream().map(h -> PREFIX + h).toList());
        }
        redis.delete(index);
    }
}
