package com.preface.api.reconstruction.service;

import com.preface.common.reconstruction.queue.ReconstructionQueueKeys;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.springframework.data.redis.connection.RedisListCommands;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Spring 안의 복원 대기열(Redis). 워커는 Redis에 붙지 않고 INT-REC-01 claim API로 가져간다.
 *
 * <pre>
 * recon:jobs          list  대기. LPUSH로 넣고 오른쪽에서 꺼낸다(먼저 들어온 것이 먼저)
 * recon:processing    list  넘겨준 작업. 결과 보고가 커밋된 뒤에 지운다
 * recon:claim:{jobId} hash  workerId, claimedAt, lastSeenAt(epoch ms), attempts — TTL 2일
 * </pre>
 *
 * <p>List + LMOVE를 고른 이유: 소비자가 워커가 아니라 Spring이라 Streams consumer group의 소비자별 PEL 이점이 적고, 처리 중 목록 +
 * 메타 hash로 lease·재큐잉 규칙을 그대로 표현할 수 있다. 값은 jobId뿐이고 작업 정보의 원본은 DB다.
 *
 * <p>lease가 끝난 작업의 회수(재큐잉·TIMEOUT)는 job-manager({@code LeaseRecoveryService})가 한다.
 */
@Component
class ReconstructionQueue {

    // key 이름은 lease 회수(job-manager)와 같아야 해서 common에 둔다
    static final String JOBS = ReconstructionQueueKeys.JOBS;
    static final String PROCESSING = ReconstructionQueueKeys.PROCESSING;
    static final String CLAIM_PREFIX = ReconstructionQueueKeys.CLAIM_PREFIX;
    static final Duration CLAIM_TTL = ReconstructionQueueKeys.CLAIM_TTL;

    private static final String WORKER_ID = ReconstructionQueueKeys.WORKER_ID;
    private static final String CLAIMED_AT = ReconstructionQueueKeys.CLAIMED_AT;
    private static final String LAST_SEEN_AT = ReconstructionQueueKeys.LAST_SEEN_AT;
    private static final String ATTEMPTS = ReconstructionQueueKeys.ATTEMPTS;

    private final StringRedisTemplate redis;

    ReconstructionQueue(StringRedisTemplate redis) {
        this.redis = redis;
    }

    record Claim(String workerId, Instant lastSeenAt, int attempts) {

        boolean ownedBy(String otherWorkerId) {
            return workerId == null || workerId.equals(otherWorkerId);
        }
    }

    void enqueue(String jobId) {
        redis.opsForList().leftPush(JOBS, jobId);
    }

    /** 대기 중 하나를 처리 중 목록으로 원자적으로 옮긴다. 비었으면 null. */
    String moveToProcessing() {
        return redis.opsForList()
                .move(
                        JOBS,
                        RedisListCommands.Direction.RIGHT,
                        PROCESSING,
                        RedisListCommands.Direction.LEFT);
    }

    int recordClaim(String jobId, String workerId, Instant now) {
        String key = CLAIM_PREFIX + jobId;
        redis.opsForHash()
                .putAll(
                        key,
                        Map.of(
                                WORKER_ID,
                                workerId,
                                CLAIMED_AT,
                                Long.toString(now.toEpochMilli()),
                                LAST_SEEN_AT,
                                Long.toString(now.toEpochMilli())));
        Long attempt = redis.opsForHash().increment(key, ATTEMPTS, 1);
        redis.expire(key, CLAIM_TTL);
        return Math.toIntExact(attempt);
    }

    Optional<Claim> claim(String jobId) {
        Map<Object, Object> entries = redis.opsForHash().entries(CLAIM_PREFIX + jobId);
        if (entries.isEmpty()) {
            return Optional.empty();
        }
        Object lastSeen = entries.get(LAST_SEEN_AT);
        Object attempts = entries.get(ATTEMPTS);
        return Optional.of(
                new Claim(
                        (String) entries.get(WORKER_ID),
                        lastSeen == null
                                ? null
                                : Instant.ofEpochMilli(Long.parseLong((String) lastSeen)),
                        attempts == null ? 0 : Integer.parseInt((String) attempts)));
    }

    /** 진행 보고·URL 발급 때 lease를 늘린다. */
    void touch(String jobId, Instant now) {
        String key = CLAIM_PREFIX + jobId;
        redis.opsForHash().put(key, LAST_SEEN_AT, Long.toString(now.toEpochMilli()));
        redis.expire(key, CLAIM_TTL);
    }

    /**
     * 처리 중이던 작업을 대기열로 되돌린다(INTERNAL 실패 재시도). 시도 횟수는 남겨 다음 claim에서 이어 센다. job-manager {@code
     * LeaseQueue.requeue}와 같은 규칙이다.
     */
    void requeue(String jobId) {
        redis.opsForList().leftPush(JOBS, jobId);
        redis.opsForList().remove(PROCESSING, 0, jobId);
        redis.opsForHash().delete(CLAIM_PREFIX + jobId, WORKER_ID, LAST_SEEN_AT);
    }

    /** 끝난 작업을 처리 중 목록과 메타에서 지운다. */
    void complete(String jobId) {
        redis.opsForList().remove(PROCESSING, 0, jobId);
        redis.delete(CLAIM_PREFIX + jobId);
    }

    /** claim하려다 건너뛴 작업(취소·이미 처리 중 등)을 처리 중 목록에서 하나 뺀다. */
    void dropOne(String jobId) {
        redis.opsForList().remove(PROCESSING, 1, jobId);
    }
}
