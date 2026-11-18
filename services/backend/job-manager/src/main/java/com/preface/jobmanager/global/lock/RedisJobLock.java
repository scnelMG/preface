package com.preface.jobmanager.global.lock;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/**
 * 스케줄 작업 중복 실행 방지 락. job-manager가 여러 인스턴스로 떠도 같은 작업은 한 곳에서만 돈다.
 *
 * <p>{@code SET key token NX PX ttl}로 잡고, 끝나면 내 token일 때만 지운다(Lua). TTL은 인스턴스가 죽어도 락이 영원히 남지 않게 하는
 * 안전장치라 작업 최대 소요 시간보다 길게 준다. TTL이 먼저 끝나 두 인스턴스가 겹쳐도 각 작업은 멱등이다(S3 DeleteObject·행 잠금).
 */
@Slf4j
@Component
public class RedisJobLock {

    private static final RedisScript<Long> RELEASE =
            new DefaultRedisScript<>(
                    "if redis.call('get', KEYS[1]) == ARGV[1] then"
                            + " return redis.call('del', KEYS[1]) else return 0 end",
                    Long.class);

    private final StringRedisTemplate redis;

    public RedisJobLock(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** 락을 잡으면 {@code task}를 실행하고 true. 다른 인스턴스가 잡고 있으면 실행하지 않고 false. */
    public boolean runExclusively(String key, Duration ttl, Runnable task) {
        String token = UUID.randomUUID().toString();
        if (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key, token, ttl))) {
            log.debug("job lock busy: key={}", key);
            return false;
        }
        try {
            task.run();
        } finally {
            redis.execute(RELEASE, List.of(key), token);
        }
        return true;
    }
}
