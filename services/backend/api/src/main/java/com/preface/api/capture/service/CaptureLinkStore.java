package com.preface.api.capture.service;

import com.preface.api.capture.dto.CaptureLinkStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/**
 * QR 링크 저장소(Redis만, DB 테이블 없음 — ERD v2.2 결정). 모든 키에 TTL을 건다.
 *
 * <pre>
 * capture:link:{sha256(token)}   HASH  linkId·userId·status·expiresAt(epoch ms)·jobId
 *                                      TTL: WAITING이면 QR 유효 시간(180초), 교환 뒤에는 세션 수명(30분)
 * capture:link-id:{linkId}       STRING "{userId}:{tokenHash}" — linkId로 찾기·주인 확인. TTL 세션 수명
 * capture:user-link:{userId}     STRING linkId — 사용자당 유효 링크 1개. TTL 세션 수명
 * </pre>
 *
 * <p>토큰 원문은 저장하지 않는다. {@code link-id}를 해시보다 오래 두는 이유: QR이 180초 만에 사라져도 PC 폴링(API-QR-03)이 404 대신
 * {@code EXPIRED}를 받게 하려고.
 *
 * <p>상태 변경은 Lua 스크립트로 한다. 키가 없을 때 HSET을 하면 TTL 없는 키가 새로 생기고, 교환은 두 기기가 동시에 해도 하나만 성공해야 해서다.
 */
@Component
@RequiredArgsConstructor
class CaptureLinkStore {

    private static final String LINK_PREFIX = "capture:link:";
    private static final String LINK_ID_PREFIX = "capture:link-id:";
    private static final String USER_LINK_PREFIX = "capture:user-link:";

    /**
     * KEYS: link, link-id, user-link / ARGV: linkId, userId, expiresAt, linkTtlMs, refTtlMs, ref
     */
    private static final RedisScript<Long> CREATE =
            new DefaultRedisScript<>(
                    """
                    redis.call('HSET', KEYS[1], 'linkId', ARGV[1], 'userId', ARGV[2], \
                    'status', 'WAITING', 'expiresAt', ARGV[3])
                    redis.call('PEXPIRE', KEYS[1], ARGV[4])
                    redis.call('SET', KEYS[2], ARGV[6], 'PX', ARGV[5])
                    redis.call('SET', KEYS[3], ARGV[1], 'PX', ARGV[5])
                    return 1
                    """,
                    Long.class);

    /** WAITING일 때만 CONNECTED로 바꾼다(1회용). KEYS: link / ARGV: sessionExpiresAt, sessionTtlMs */
    @SuppressWarnings("rawtypes")
    private static final RedisScript<List> EXCHANGE =
            new DefaultRedisScript<>(
                    """
                    local h = redis.call('HMGET', KEYS[1], 'status', 'linkId', 'userId')
                    if not h[1] then return {'MISSING', '', ''} end
                    if h[1] ~= 'WAITING' then return {h[1], h[2], h[3]} end
                    redis.call('HSET', KEYS[1], 'status', 'CONNECTED', 'expiresAt', ARGV[1])
                    redis.call('PEXPIRE', KEYS[1], ARGV[2])
                    return {'OK', h[2], h[3]}
                    """,
                    List.class);

    /**
     * 키가 있고 현재 상태가 허용 목록에 있을 때만 바꾼다. TTL은 그대로 둔다. KEYS: link / ARGV: 새 상태, jobId(없으면 ''), 허용 상태...
     */
    private static final RedisScript<Long> TRANSITION =
            new DefaultRedisScript<>(
                    """
                    local s = redis.call('HGET', KEYS[1], 'status')
                    if not s then return 0 end
                    for i = 3, #ARGV do
                      if s == ARGV[i] then
                        redis.call('HSET', KEYS[1], 'status', ARGV[1])
                        if ARGV[2] ~= '' then redis.call('HSET', KEYS[1], 'jobId', ARGV[2]) end
                        return 1
                      end
                    end
                    return 0
                    """,
                    Long.class);

    private final StringRedisTemplate redis;

    void create(
            String linkId,
            String userId,
            String tokenHash,
            Instant expiresAt,
            Duration linkTtl,
            Duration refTtl) {
        redis.execute(
                CREATE,
                List.of(linkKey(tokenHash), linkIdKey(linkId), userLinkKey(userId)),
                linkId,
                userId,
                String.valueOf(expiresAt.toEpochMilli()),
                String.valueOf(linkTtl.toMillis()),
                String.valueOf(refTtl.toMillis()),
                userId + ":" + tokenHash);
    }

    Optional<String> currentLinkIdOf(String userId) {
        return Optional.ofNullable(redis.opsForValue().get(userLinkKey(userId)));
    }

    /** link-id가 남아 있으면 찾는다. 해시가 이미 만료됐으면 {@code EXPIRED}로 돌려준다. */
    Optional<Link> find(String linkId) {
        String ref = redis.opsForValue().get(linkIdKey(linkId));
        if (ref == null) {
            return Optional.empty();
        }
        int sep = ref.indexOf(':');
        String userId = ref.substring(0, sep);
        String tokenHash = ref.substring(sep + 1);
        List<Object> values =
                redis.opsForHash()
                        .multiGet(linkKey(tokenHash), List.of("status", "expiresAt", "jobId"));
        if (values.get(0) == null) {
            return Optional.of(
                    new Link(linkId, userId, tokenHash, CaptureLinkStatus.EXPIRED, null, null));
        }
        Instant expiresAt =
                values.get(1) == null
                        ? null
                        : Instant.ofEpochMilli(Long.parseLong((String) values.get(1)));
        return Optional.of(
                new Link(
                        linkId,
                        userId,
                        tokenHash,
                        CaptureLinkStatus.valueOf((String) values.get(0)),
                        expiresAt,
                        (String) values.get(2)));
    }

    /** 원자적 교환. 성공하면 link-id·user-link TTL도 세션 수명으로 늘린다. */
    @SuppressWarnings("unchecked")
    ExchangeResult exchange(String tokenHash, Instant sessionExpiresAt, Duration sessionTtl) {
        List<String> result =
                (List<String>)
                        redis.execute(
                                EXCHANGE,
                                List.of(linkKey(tokenHash)),
                                String.valueOf(sessionExpiresAt.toEpochMilli()),
                                String.valueOf(sessionTtl.toMillis()));
        String outcome = result.get(0);
        String linkId = result.get(1);
        String userId = result.get(2);
        if ("OK".equals(outcome)) {
            redis.expire(linkIdKey(linkId), sessionTtl);
            redis.expire(userLinkKey(userId), sessionTtl);
            return new ExchangeResult(true, null, linkId, userId);
        }
        CaptureLinkStatus status =
                "MISSING".equals(outcome)
                        ? CaptureLinkStatus.EXPIRED
                        : CaptureLinkStatus.valueOf(outcome);
        return new ExchangeResult(false, status, linkId, userId);
    }

    /** {@code from} 상태 중 하나일 때만 {@code to}로 바꾼다. 바꿨으면 true. */
    boolean transition(
            String tokenHash, CaptureLinkStatus to, String jobId, CaptureLinkStatus... from) {
        String[] args = new String[from.length + 2];
        args[0] = to.name();
        args[1] = jobId == null ? "" : jobId;
        for (int i = 0; i < from.length; i++) {
            args[i + 2] = from[i].name();
        }
        Long changed = redis.execute(TRANSITION, List.of(linkKey(tokenHash)), (Object[]) args);
        return changed != null && changed == 1;
    }

    private static String linkKey(String tokenHash) {
        return LINK_PREFIX + tokenHash;
    }

    private static String linkIdKey(String linkId) {
        return LINK_ID_PREFIX + linkId;
    }

    private static String userLinkKey(String userId) {
        return USER_LINK_PREFIX + userId;
    }

    record Link(
            String linkId,
            String userId,
            String tokenHash,
            CaptureLinkStatus status,
            Instant expiresAt,
            String jobId) {}

    /**
     * @param status 실패했을 때 링크 상태(만료·없음은 EXPIRED)
     */
    record ExchangeResult(
            boolean connected, CaptureLinkStatus status, String linkId, String userId) {}
}
