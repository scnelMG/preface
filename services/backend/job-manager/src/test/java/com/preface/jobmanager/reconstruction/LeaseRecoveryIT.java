package com.preface.jobmanager.reconstruction;

import static com.preface.jobmanager.ItRows.ago;
import static org.assertj.core.api.Assertions.assertThat;

import com.preface.common.reconstruction.ReconstructionOutputKeys;
import com.preface.jobmanager.ItRows;
import com.preface.jobmanager.JobManagerTestcontainers;
import com.preface.jobmanager.deletion.service.DeletionStorage;
import com.preface.jobmanager.reconstruction.service.LeaseRecoveryService;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * lease 회수를 실제 MySQL·Redis로 확인한다. Redis 상태는 api claim(INT-REC-01)이 남기는 형식 그대로 만든다(계약 README "Spring
 * 안의 큐").
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@Import(JobManagerTestcontainers.class)
class LeaseRecoveryIT {

    @Autowired LeaseRecoveryService recovery;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;

    // DeletionJobIT와 같은 컨텍스트를 재사용하려고 같은 mock을 둔다
    @MockitoBean DeletionStorage storage;

    private ItRows rows;
    private String userId;

    @BeforeEach
    void setUp() {
        rows = new ItRows(jdbc);
        clearQueue();
        userId = rows.user();
    }

    @AfterEach
    void tearDown() {
        clearQueue();
    }

    @Test
    void lease가_끝나면_한_번은_대기열로_돌리고_두_번째는_TIMEOUT으로_실패시킨다() {
        String uploadId = rows.upload(userId, "UPLOADED", ago(Duration.ofHours(-24)));
        String jobId = rows.job(userId, uploadId, "RUNNING");
        claimedBy(jobId, "it-worker-1", 1, Duration.ofHours(1));

        assertThat(recovery.recoverExpired().requeued()).isEqualTo(1);
        assertThat(job(jobId)).containsEntry("status", "QUEUED");
        assertThat(redis.opsForList().range("recon:jobs", 0, -1)).containsExactly(jobId);
        assertThat(redis.opsForList().size("recon:processing")).isZero();
        assertThat(redis.opsForHash().entries("recon:claim:" + jobId))
                .containsEntry("attempts", "1")
                .doesNotContainKeys("workerId", "lastSeenAt");

        // 다른 워커가 다시 가져갔다가(api claim과 같은 상태) 또 끊긴다
        redis.opsForList().remove("recon:jobs", 0, jobId);
        jdbc.update("update reconstruction_job set status = 'RUNNING' where id = ?", jobId);
        claimedBy(jobId, "it-worker-2", 2, Duration.ofMinutes(11));

        Instant before = Instant.now().minusSeconds(1);
        assertThat(recovery.recoverExpired().timedOut()).isEqualTo(1);
        Map<String, Object> failed = job(jobId);
        assertThat(failed).containsEntry("status", "FAILED");
        assertThat(failed.get("fail_codes").toString()).isEqualTo("[\"TIMEOUT\"]");
        assertThat(failed.get("finished_at")).isNotNull();
        Instant retention =
                jdbc.queryForObject(
                                "select retention_expires_at from face_upload where id = ?",
                                LocalDateTime.class,
                                uploadId)
                        .toInstant(ZoneOffset.UTC);
        assertThat(retention)
                .isBetween(
                        before.plus(Duration.ofHours(24)).minusSeconds(1),
                        Instant.now().plus(Duration.ofHours(24)).plusSeconds(1));
        assertThat(
                        jdbc.queryForList(
                                "select type from notification where user_id = ? and target_id = ?",
                                String.class,
                                userId,
                                jobId))
                .containsExactly("RECON_FAILED");
        assertThat(redis.opsForList().size("recon:processing")).isZero();
        assertThat(redis.hasKey("recon:claim:" + jobId)).isFalse();
    }

    @Test
    void lease가_남은_작업은_그대로_두고_이미_끝난_작업은_처리_중_목록에서만_지운다() {
        String liveJob =
                rows.job(userId, rows.upload(userId, "UPLOADED", ago(Duration.ZERO)), "RUNNING");
        claimedBy(liveJob, "it-worker-1", 1, Duration.ofMinutes(1));
        String doneJob =
                rows.job(userId, rows.upload(userId, "UPLOADED", ago(Duration.ZERO)), "SUCCEEDED");
        claimedBy(doneJob, "it-worker-2", 1, Duration.ofHours(1));

        LeaseRecoveryService.Summary summary = recovery.recoverExpired();

        assertThat(summary).isEqualTo(new LeaseRecoveryService.Summary(0, 0, 1));
        assertThat(job(liveJob)).containsEntry("status", "RUNNING");
        assertThat(redis.opsForList().range("recon:processing", 0, -1)).containsExactly(liveJob);
        assertThat(redis.hasKey("recon:claim:" + doneJob)).isFalse();
    }

    @Test
    void GPU_대기열에서_오래_기다린_작업만_TIMEOUT으로_끝내고_대기열에서_지운다() {
        String staleJob = awaitingGpu(Duration.ofMinutes(25));
        String freshJob = awaitingGpu(Duration.ofMinutes(5));

        recovery.timeOutUnclaimed();

        Map<String, Object> failed = job(staleJob);
        assertThat(failed).containsEntry("status", "FAILED");
        assertThat(failed.get("fail_codes").toString()).isEqualTo("[\"TIMEOUT\"]");
        assertThat(
                        jdbc.queryForList(
                                "select type from notification where user_id = ? and target_id = ?",
                                String.class,
                                userId,
                                staleJob))
                .containsExactly("RECON_FAILED");
        assertThat(job(freshJob)).containsEntry("status", "QUEUED");
        assertThat(redis.opsForList().range("recon:jobs", 0, -1)).containsExactly(freshJob);
    }

    @Test
    void GPU_워커가_일하는_중이면_오래_기다린_작업도_TIMEOUT하지_않는다() {
        String running =
                rows.job(userId, rows.upload(userId, "UPLOADED", ago(Duration.ZERO)), "RUNNING");
        claimedBy(running, "it-worker-1", 1, Duration.ofMinutes(1));
        String waiting = awaitingGpu(Duration.ofMinutes(25));

        recovery.timeOutUnclaimed();

        assertThat(job(waiting)).containsEntry("status", "QUEUED");
        assertThat(redis.opsForList().range("recon:jobs", 0, -1)).containsExactly(waiting);
    }

    @Test
    void 추출_워커가_아무도_안_가져간_작업과_시도를_다_쓴_작업만_TIMEOUT으로_끝낸다() {
        String unclaimed = awaitingFrames(Duration.ofMinutes(25), null, 0);
        String exhausted = awaitingFrames(Duration.ofMinutes(11), Duration.ofMinutes(11), 2);
        String fresh = awaitingFrames(Duration.ofMinutes(5), null, 0);
        String extracting = awaitingFrames(Duration.ofMinutes(25), Duration.ofMinutes(1), 1);

        recovery.timeOutExtraction();

        for (String jobId : List.of(unclaimed, exhausted)) {
            Map<String, Object> failed = job(jobId);
            assertThat(failed).containsEntry("status", "FAILED");
            assertThat(failed.get("fail_codes").toString()).isEqualTo("[\"TIMEOUT\"]");
            assertThat(
                            jdbc.queryForList(
                                    "select type from notification where user_id = ? and target_id = ?",
                                    String.class,
                                    userId,
                                    jobId))
                    .containsExactly("RECON_FAILED");
        }
        String exhaustedUpload =
                jdbc.queryForObject(
                        "select face_upload_id from reconstruction_job where id = ?",
                        String.class,
                        exhausted);
        assertThat(
                        jdbc.queryForList(
                                "select object_key from data_deletion_log"
                                        + " where target_type = 'FACE_UPLOAD_FRAMES' and target_id = ?",
                                String.class,
                                exhaustedUpload))
                .containsExactlyInAnyOrder(
                        ReconstructionOutputKeys.framesBundle(userId, exhaustedUpload, 1),
                        ReconstructionOutputKeys.framesBundle(userId, exhaustedUpload, 2));
        assertThat(job(fresh)).containsEntry("status", "QUEUED");
        assertThat(job(extracting)).containsEntry("status", "QUEUED");
    }

    @Test
    void 대기열에서_빠진_GPU_대기_작업만_다시_넣고_막_들어온_작업은_건드리지_않는다() {
        String lost = awaitingGpu(Duration.ofMinutes(5));
        redis.opsForList().remove("recon:jobs", 0, lost);
        String waiting = awaitingGpu(Duration.ofMinutes(5));
        String justCommitted = awaitingGpu(Duration.ofSeconds(30));
        redis.opsForList().remove("recon:jobs", 0, justCommitted);

        // 같은 DB를 쓰는 앞 테스트의 GPU 대기 행도 대기열이 비워져 있으면 함께 돌아온다. 이 테스트의 세 작업만 본다
        assertThat(recovery.restoreGpuQueue()).isPositive();

        List<String> queued = redis.opsForList().range("recon:jobs", 0, -1);
        assertThat(queued).containsOnlyOnce(lost, waiting).doesNotContain(justCommitted);
    }

    /**
     * 추출 대기 작업(프레임 없음). 마지막 변경이 {@code idle} 전이고, 추출 워커가 {@code claimedAgo} 전에 {@code attempts}번째로
     * 가져갔다(null이면 아무도 안 가져감).
     */
    private String awaitingFrames(Duration idle, Duration claimedAgo, int attempts) {
        String jobId =
                rows.job(userId, rows.upload(userId, "UPLOADED", ago(Duration.ZERO)), "QUEUED");
        jdbc.update(
                "update reconstruction_job set frames_ready_at = null, updated_at = ?,"
                        + " extract_claimed_at = ?, extract_attempts = ?,"
                        + " extract_worker_id = ? where id = ?",
                ago(idle),
                claimedAgo == null ? null : ago(claimedAgo),
                attempts,
                claimedAgo == null ? null : "it-extractor",
                jobId);
        return jobId;
    }

    /** 추출이 끝나 GPU 대기열에 들어간 작업(api 추출 완료가 남기는 상태). {@code waited} 전부터 기다렸다. */
    private String awaitingGpu(Duration waited) {
        String jobId =
                rows.job(userId, rows.upload(userId, "UPLOADED", ago(Duration.ZERO)), "QUEUED");
        jdbc.update(
                "update reconstruction_job set frames_ready_at = ?, updated_at = ?,"
                        + " stage = 'QUALITY_CHECK' where id = ?",
                ago(waited),
                ago(waited),
                jobId);
        redis.opsForList().leftPush("recon:jobs", jobId);
        return jobId;
    }

    /** api claim이 남기는 상태: 처리 중 목록 + claim 메타(lastSeenAt = 지금 - {@code silentFor}). */
    private void claimedBy(String jobId, String workerId, int attempts, Duration silentFor) {
        long lastSeen = Instant.now().minus(silentFor).toEpochMilli();
        redis.opsForList().leftPush("recon:processing", jobId);
        redis.opsForHash()
                .putAll(
                        "recon:claim:" + jobId,
                        Map.of(
                                "workerId", workerId,
                                "claimedAt", Long.toString(lastSeen),
                                "lastSeenAt", Long.toString(lastSeen),
                                "attempts", Integer.toString(attempts)));
        redis.expire("recon:claim:" + jobId, Duration.ofDays(2));
    }

    private Map<String, Object> job(String jobId) {
        return jdbc.queryForMap("select * from reconstruction_job where id = ?", jobId);
    }

    private void clearQueue() {
        List<String> ids = new ArrayList<>();
        for (String list : List.of("recon:jobs", "recon:processing")) {
            List<String> range = redis.opsForList().range(list, 0, -1);
            if (range != null) {
                ids.addAll(range);
            }
        }
        ids.forEach(id -> redis.delete("recon:claim:" + id));
        redis.delete(List.of("recon:jobs", "recon:processing"));
    }
}
