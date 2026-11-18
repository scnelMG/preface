package com.preface.jobmanager.reconstruction.service;

import static com.preface.common.reconstruction.queue.ReconstructionQueueKeys.ATTEMPTS;
import static com.preface.common.reconstruction.queue.ReconstructionQueueKeys.CLAIM_TTL;
import static com.preface.common.reconstruction.queue.ReconstructionQueueKeys.JOBS;
import static com.preface.common.reconstruction.queue.ReconstructionQueueKeys.LAST_SEEN_AT;
import static com.preface.common.reconstruction.queue.ReconstructionQueueKeys.PROCESSING;
import static com.preface.common.reconstruction.queue.ReconstructionQueueKeys.WORKER_ID;

import com.preface.common.reconstruction.queue.ReconstructionQueueKeys;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * lease 회수가 쓰는 복원 대기열 동작. key·필드는 api {@code ReconstructionQueue}(claim·진행 보고)와 같다({@link
 * com.preface.common.reconstruction.queue.ReconstructionQueueKeys}).
 */
@Component
class LeaseQueue {

    private final StringRedisTemplate redis;

    LeaseQueue(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /**
     * @param lastSeenAt 마지막 claim·진행 보고 시각. 없으면 null
     */
    record Claim(Instant lastSeenAt, int attempts) {}

    List<String> processing() {
        List<String> ids = redis.opsForList().range(PROCESSING, 0, -1);
        return ids == null ? List.of() : ids;
    }

    /** GPU 대기열({@code recon:jobs})에 있는 작업 ID. */
    List<String> waiting() {
        List<String> ids = redis.opsForList().range(JOBS, 0, -1);
        return ids == null ? List.of() : ids;
    }

    /** 대기열 뒤에 넣는다(api {@code ReconstructionQueue.enqueue}와 같은 방향). */
    void enqueue(String jobId) {
        redis.opsForList().leftPush(JOBS, jobId);
    }

    Optional<Claim> claim(String jobId) {
        Map<Object, Object> entries = redis.opsForHash().entries(claimKey(jobId));
        if (entries.isEmpty()) {
            return Optional.empty();
        }
        Object lastSeen = entries.get(LAST_SEEN_AT);
        Object attempts = entries.get(ATTEMPTS);
        return Optional.of(
                new Claim(
                        lastSeen == null
                                ? null
                                : Instant.ofEpochMilli(Long.parseLong((String) lastSeen)),
                        attempts == null ? 0 : Integer.parseInt((String) attempts)));
    }

    /** 처리 중인데 메타가 없는 작업(claim 기록 직전 장애 등)에 지금부터 lease를 시작한다. */
    void startLease(String jobId, Instant now) {
        String key = claimKey(jobId);
        redis.opsForHash().put(key, LAST_SEEN_AT, Long.toString(now.toEpochMilli()));
        redis.expire(key, CLAIM_TTL);
    }

    /**
     * 회수한 작업을 대기열 뒤로 돌린다. 넣고 나서 지운다(중간에 끊기면 중복이 남을 뿐 작업이 사라지지 않는다. 중복은 claim이 건너뛴다). 시도 횟수는 남기고
     * 워커·lease 기록만 지운다.
     */
    void requeue(String jobId) {
        redis.opsForList().leftPush(JOBS, jobId);
        redis.opsForList().remove(PROCESSING, 0, jobId);
        redis.opsForHash().delete(claimKey(jobId), WORKER_ID, LAST_SEEN_AT);
    }

    /** 끝난 작업을 처리 중 목록과 메타에서 지운다. */
    void complete(String jobId) {
        redis.opsForList().remove(PROCESSING, 0, jobId);
        redis.delete(claimKey(jobId));
    }

    /**
     * 시간 초과로 끝낸 대기 작업을 대기열·처리 중 목록·메타에서 지운다(S15P31B204-528). 지우기 전에 claim이 꺼내 갔어도 DB가 FAILED라
     * claim은 건너뛴다.
     */
    void removeWaiting(String jobId) {
        redis.opsForList().remove(JOBS, 0, jobId);
        complete(jobId);
    }

    private static String claimKey(String jobId) {
        return ReconstructionQueueKeys.claim(jobId);
    }
}
