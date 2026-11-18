package com.preface.api.auth.service;

import com.preface.api.auth.service.oauth.OAuthProfile;
import com.preface.common.user.entity.OAuthProvider;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * 가입 대기 정보. Redis hash {@code signup:pending:{pendingId}}, 가입 토큰과 같은 TTL(10분 [가정]).
 *
 * <p>회원 행을 동의 저장 전에 만들지 않기 위해(REQ-F-01) 제공자 정보를 여기 잠시 둔다. 키는 가입 토큰의 subject(난수 ID)다. 명세는 {@code
 * sha256(signupToken)}을 키로 적었지만, 토큰 원문이 키에 들어가지 않는다는 목적은 같고 토큰 검증 결과(subject)로 바로 찾을 수 있다.
 *
 * <p>가입이 끝나면 지우지 않고 {@code userId}를 적어 둔다. 같은 가입 토큰으로 재시도하면 이미 만든 회원의 세션을 돌려주기 위해서다(멱등).
 */
@Component
@RequiredArgsConstructor
class SignupPendingStore {

    private static final String PREFIX = "signup:pending:";

    private final StringRedisTemplate redis;

    void save(String pendingId, OAuthProfile profile, Duration ttl) {
        Map<String, String> fields = new HashMap<>();
        fields.put("provider", profile.provider().name());
        fields.put("providerUserId", profile.providerUserId());
        if (profile.nickname() != null) {
            fields.put("nickname", profile.nickname());
        }
        if (profile.email() != null) {
            fields.put("email", profile.email());
        }
        String key = PREFIX + pendingId;
        redis.opsForHash().putAll(key, fields);
        redis.expire(key, ttl);
    }

    Optional<Pending> find(String pendingId) {
        Map<Object, Object> fields = redis.opsForHash().entries(PREFIX + pendingId);
        if (fields.isEmpty()) {
            return Optional.empty();
        }
        OAuthProfile profile =
                new OAuthProfile(
                        OAuthProvider.valueOf((String) fields.get("provider")),
                        (String) fields.get("providerUserId"),
                        (String) fields.get("nickname"),
                        (String) fields.get("email"));
        return Optional.of(new Pending(profile, (String) fields.get("userId")));
    }

    /** TTL은 그대로 두고 완료 표시만 한다. */
    void markCompleted(String pendingId, String userId) {
        redis.opsForHash().put(PREFIX + pendingId, "userId", userId);
    }

    record Pending(OAuthProfile profile, String completedUserId) {}
}
