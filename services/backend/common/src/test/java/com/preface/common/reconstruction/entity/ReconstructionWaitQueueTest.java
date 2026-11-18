package com.preface.common.reconstruction.entity;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class ReconstructionWaitQueueTest {

    private static final Instant NOW = Instant.parse("2026-11-10T03:00:00Z");
    private static final Duration LEASE = Duration.ofMinutes(10);
    private static final Instant STALE_BEFORE = NOW.minus(LEASE);

    @Test
    void 접수_직후는_추출_대기이고_접수_시각부터_기다린다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");

        ReconstructionWaitQueue queue = job.waitQueue(STALE_BEFORE);

        assertThat(queue).isEqualTo(ReconstructionWaitQueue.EXTRACT);
        assertThat(queue.since(NOW.minusSeconds(5), NOW, null, LEASE))
                .isEqualTo(NOW.minusSeconds(5));
    }

    @Test
    void 추출_lease가_살아_있으면_기다리지_않고_끝나면_lease가_끝난_시각부터_다시_기다린다() {
        ReconstructionJob live = ReconstructionJob.queue("u", "up");
        live.claimExtraction("w", NOW.minusSeconds(30));
        assertThat(live.waitQueue(STALE_BEFORE)).isNull();

        ReconstructionJob expired = ReconstructionJob.queue("u", "up");
        Instant claimedAt = STALE_BEFORE.minusSeconds(1);
        expired.claimExtraction("w", claimedAt);
        ReconstructionWaitQueue queue = expired.waitQueue(STALE_BEFORE);

        assertThat(queue).isEqualTo(ReconstructionWaitQueue.EXTRACT);
        assertThat(queue.since(NOW.minus(Duration.ofHours(1)), NOW, claimedAt, LEASE))
                .isEqualTo(claimedAt.plus(LEASE));
    }

    @Test
    void 프레임이_준비되면_GPU_대기이고_updated_at부터_기다린다_시작하면_기다리지_않는다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        job.claimExtraction("w", NOW.minusSeconds(60));
        job.framesReady(NOW.minusSeconds(20));

        ReconstructionWaitQueue queue = job.waitQueue(STALE_BEFORE);

        assertThat(queue).isEqualTo(ReconstructionWaitQueue.GPU);
        assertThat(queue.since(NOW.minusSeconds(90), NOW.minusSeconds(20), null, LEASE))
                .isEqualTo(NOW.minusSeconds(20));

        job.start(NOW);
        assertThat(job.waitQueue(STALE_BEFORE)).isNull();
        job.requeue();
        assertThat(job.waitQueue(STALE_BEFORE))
                .as("GPU lease 회수로 돌아오면 다시 GPU 대기")
                .isEqualTo(ReconstructionWaitQueue.GPU);
    }
}
