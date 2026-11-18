package com.preface.api.notification.service;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * 확인 중인 Mattermost 아이디. Redis hash {@code notification:mm-verify:{userId}}(코드 TTL), 다시 받기 제한은
 * {@code notification:mm-resend:{userId}}(간격 TTL). 코드는 원문 대신 SHA-256만 둔다.
 */
@Component
@RequiredArgsConstructor
class MattermostVerificationStore {

    private static final String VERIFY = "notification:mm-verify:";
    private static final String RESEND = "notification:mm-resend:";

    private final StringRedisTemplate redis;

    /** 다시 받기 간격이 지났으면 자리를 잡고 true. 간격 안이면 false. */
    boolean tryReserveSend(String userId, Duration interval) {
        return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(RESEND + userId, "1", interval));
    }

    void releaseSend(String userId) {
        redis.delete(RESEND + userId);
    }

    /** 새 코드로 바꾼다. 틀린 횟수는 0부터 다시 센다. */
    void save(String userId, String username, String codeHash, Duration ttl) {
        String key = VERIFY + userId;
        redis.delete(key);
        redis.opsForHash()
                .putAll(key, Map.of("username", username, "codeHash", codeHash, "attempts", "0"));
        redis.expire(key, ttl);
    }

    Optional<Pending> find(String userId) {
        Map<Object, Object> fields = redis.opsForHash().entries(VERIFY + userId);
        if (fields.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(
                new Pending((String) fields.get("username"), (String) fields.get("codeHash")));
    }

    /** 틀린 횟수를 하나 올리고 올린 값을 돌려준다. */
    long incrementAttempts(String userId) {
        String key = VERIFY + userId;
        long attempts = redis.opsForHash().increment(key, "attempts", 1);
        if (!redis.opsForHash().hasKey(key, "codeHash")) {
            // 조회와 증가 사이에 만료됐으면 증가가 TTL 없는 키를 새로 만든다. 남기지 않는다
            redis.delete(key);
        }
        return attempts;
    }

    void delete(String userId) {
        redis.delete(VERIFY + userId);
    }

    record Pending(String username, String codeHash) {}
}
