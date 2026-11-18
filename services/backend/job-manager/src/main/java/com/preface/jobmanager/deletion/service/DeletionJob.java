package com.preface.jobmanager.deletion.service;

import com.preface.jobmanager.global.lock.RedisJobLock;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.Set;
import java.util.function.IntSupplier;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 데이터 자동 삭제 스케줄러(매시 정각, API 명세서 "삭제 방식", FN-HIS-03~05, FN-AUTH-04의 S3 정리).
 *
 * <ol>
 *   <li>보관 만료 원본 영상 → 삭제 기록(PENDING)
 *   <li>빈 시안(24h) · 소프트 삭제 시안(30일) · 소프트 삭제 3D(30일) 물리 삭제 + 삭제 기록
 *   <li>PENDING 기록의 S3 객체 삭제(다른 기능이 남긴 행 포함) → DONE / 재시도 / FAILED
 * </ol>
 *
 * <p>여러 인스턴스가 떠도 Redis 락({@value #LOCK_KEY})을 잡은 한 곳만 돈다. 단계마다 예외를 따로 잡아 한 단계가 실패해도 나머지는 돈다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DeletionJob {

    static final String LOCK_KEY = "deletion:lock:scheduler";

    /** 한 실행에서 단계마다 도는 최대 배치 수. 밀린 양이 많아도 한 실행이 락 TTL 안에 끝나게 한다. 남은 것은 다음 실행이 한다. */
    static final int MAX_BATCHES = 50;

    private final RetentionSweeper sweeper;
    private final PendingDeletionProcessor processor;
    private final DeletionProperties properties;
    private final RedisJobLock lock;
    private final Clock clock;

    public record Summary(
            int uploads,
            int frameBundles,
            int emptySimulations,
            int simulations,
            int faceModels,
            int notifications,
            int withdrawnUsers,
            PendingDeletionProcessor.Result pending) {}

    @Scheduled(cron = "${preface.deletion.cron:0 0 * * * *}", zone = "UTC")
    public void scheduled() {
        lock.runExclusively(LOCK_KEY, properties.lockTtl(), this::runOnce);
    }

    /** 한 번 실행한다(락 없이). 스케줄은 {@link #scheduled()}로 부른다. */
    public Summary runOnce() {
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        int uploads = drain("uploads", () -> sweeper.scheduleExpiredUploads(now));
        int frameBundles = drain("frameBundles", () -> sweeper.scheduleExpiredFrameBundles(now));
        int empty = drain("emptySimulations", () -> sweeper.purgeEmptySimulations(now));
        int simulations = drain("simulations", () -> sweeper.purgeSoftDeletedSimulations(now));
        int faceModels = drain("faceModels", () -> sweeper.purgeSoftDeletedFaceModels(now));
        int notifications = drain("notifications", () -> sweeper.purgeOldNotifications(now));
        int withdrawn = drain("withdrawnUsers", () -> sweeper.purgeWithdrawnUsers(now));
        PendingDeletionProcessor.Result pending = processPending();
        Summary summary =
                new Summary(
                        uploads,
                        frameBundles,
                        empty,
                        simulations,
                        faceModels,
                        notifications,
                        withdrawn,
                        pending);
        log.info("deletion run: {}", summary);
        return summary;
    }

    private int drain(String step, IntSupplier batch) {
        int total = 0;
        try {
            for (int i = 0; i < MAX_BATCHES; i++) {
                int n = batch.getAsInt();
                total += n;
                if (n < properties.batchSize()) {
                    break;
                }
            }
        } catch (RuntimeException e) {
            log.error("deletion step failed: step={}, processed={}", step, total, e);
        }
        return total;
    }

    private PendingDeletionProcessor.Result processPending() {
        Set<String> attempted = new HashSet<>();
        PendingDeletionProcessor.Result total = PendingDeletionProcessor.Result.EMPTY;
        try {
            for (int i = 0; i < MAX_BATCHES; i++) {
                PendingDeletionProcessor.Result batch = processor.processBatch(attempted);
                total = total.plus(batch);
                if (batch.total() == 0) {
                    break;
                }
            }
        } catch (RuntimeException e) {
            log.error("deletion step failed: step=pending, processed={}", total, e);
        }
        return total;
    }
}
