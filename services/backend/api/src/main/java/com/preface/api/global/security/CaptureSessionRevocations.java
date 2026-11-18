package com.preface.api.global.security;

import java.time.Duration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * 업로드 전용 세션 폐기 목록. Redis {@code capture:revoked:{linkId}}.
 *
 * <p>업로드 전용 세션(JWT)은 서버에 저장하지 않으므로, PC가 연결을 끊거나 링크가 바뀌면 여기에 링크 ID를 올려 즉시 무효로 만든다. {@link
 * JwtAuthenticationFilter}가 매 요청 확인한다. TTL은 세션 수명과 같게 건다(그보다 오래 둘 필요가 없다 — 그때는 JWT가 먼저 만료된다).
 *
 * <p>capture 도메인이 아니라 global에 두는 이유: 보안 필터가 읽어야 하는데, 필터(global)가 capture를 의존하면 capture →
 * global(JWT)과 순환이 생긴다.
 */
@Component
public class CaptureSessionRevocations {

    private static final String PREFIX = "capture:revoked:";

    private final StringRedisTemplate redis;

    public CaptureSessionRevocations(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public void revoke(String linkId, Duration ttl) {
        redis.opsForValue().set(PREFIX + linkId, "1", ttl);
    }

    public boolean isRevoked(String linkId) {
        return Boolean.TRUE.equals(redis.hasKey(PREFIX + linkId));
    }
}
