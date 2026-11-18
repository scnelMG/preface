package com.preface.jobmanager.reconstruction.service;

import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.deletion.repository.DataDeletionLogRepository;
import com.preface.common.notification.entity.Notification;
import com.preface.common.notification.entity.NotificationType;
import com.preface.common.notification.repository.NotificationRepository;
import com.preface.common.reconstruction.ReconstructionOutputKeys;
import com.preface.common.reconstruction.entity.JobStageStatus;
import com.preface.common.reconstruction.entity.ReconstructionFailCode;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import com.preface.common.reconstruction.repository.ReconstructionJobStageRepository;
import com.preface.jobmanager.notification.service.MattermostReconNotifier;
import com.preface.jobmanager.reconstruction.repository.LeaseFaceUploadRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 처리 중 목록({@code recon:processing})에서 lease가 끝난 작업을 회수한다. 계약 README "상태와 회수 규칙".
 *
 * <ul>
 *   <li>시도 횟수 &lt; maxAttempts: QUEUED로 돌려 대기열 뒤에 넣는다(1회 재큐잉). 시도 횟수는 claim 때 api가 올린다
 *   <li>시도 횟수 ≥ maxAttempts: FAILED({@code failCodes=["TIMEOUT"]}) + 실패 알림 + 원본 삭제 예정 = 지금 + 24h
 *   <li>메타(lease 시각)가 없는 항목: 지금부터 lease를 시작한다(claim 기록 직전 장애 대비)
 *   <li>DB가 이미 끝난 상태(성공·실패·취소)거나 행이 없으면 처리 중 목록에서만 지운다
 * </ul>
 *
 * <p>GPU 대기열 시간 초과({@link #timeOutUnclaimed}, S15P31B204-528): 프레임 준비 뒤 {@code queueTimeout} 넘게 아무
 * 워커도 가져가지 않은 작업(GPU Pod가 꺼진 경우 등)은 lease가 시작되지 않아 위 규칙에 걸리지 않는다. 그래서 따로 FAILED(TIMEOUT)로 끝낸다.
 *
 * <p>DB 변경은 작업 행 잠금(FOR UPDATE) 안에서 한다 — 같은 순간 워커의 결과 보고가 오면 둘 중 하나만 반영된다. Redis 정리는 커밋 뒤에 한다(커밋 전에
 * 큐에서 빼면 실패 시 작업이 사라진다).
 *
 * <p>실패 처리(작업 FAILED + 원본 보관 24h + 알림)는 api {@code ReconstructionFinisher.fail}과 같은 규칙이다.
 * job-manager가 api 모듈에 의존하지 않아 여기 따로 둔다 — 한쪽을 바꾸면 다른 쪽도 함께 바꾼다. Mattermost DM은 커밋 뒤에 보낸다({@link
 * MattermostReconNotifier}, S15P31B204-530).
 */
@Slf4j
@Service
public class LeaseRecoveryService {

    static final String TIMEOUT_FAIL_CODES = "[\"" + ReconstructionFailCode.TIMEOUT.name() + "\"]";

    /** 대기열 맞추기에서 막 커밋된 작업을 건너뛰는 시간. api가 커밋 직후 넣는 데 걸리는 시간보다 넉넉히 길다. */
    static final Duration QUEUE_RESTORE_GRACE = Duration.ofMinutes(2);

    private final ReconstructionJobRepository jobRepository;
    private final ReconstructionJobStageRepository stageRepository;
    private final LeaseFaceUploadRepository uploadRepository;
    private final NotificationRepository notificationRepository;
    private final DataDeletionLogRepository deletionLogRepository;
    private final LeaseQueue queue;
    private final LeaseProperties properties;
    private final MattermostReconNotifier mattermost;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    public LeaseRecoveryService(
            ReconstructionJobRepository jobRepository,
            ReconstructionJobStageRepository stageRepository,
            LeaseFaceUploadRepository uploadRepository,
            NotificationRepository notificationRepository,
            DataDeletionLogRepository deletionLogRepository,
            LeaseQueue queue,
            LeaseProperties properties,
            MattermostReconNotifier mattermost,
            PlatformTransactionManager transactionManager,
            Clock clock) {
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.uploadRepository = uploadRepository;
        this.notificationRepository = notificationRepository;
        this.deletionLogRepository = deletionLogRepository;
        this.queue = queue;
        this.properties = properties;
        this.mattermost = mattermost;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    enum Outcome {
        REQUEUED,
        TIMED_OUT,
        CLEANED
    }

    public record Summary(int requeued, int timedOut, int cleaned) {}

    public Summary recoverExpired() {
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        int requeued = 0;
        int timedOut = 0;
        int cleaned = 0;
        for (String jobId : queue.processing()) {
            Optional<LeaseQueue.Claim> claim = queue.claim(jobId);
            if (claim.isEmpty() || claim.get().lastSeenAt() == null) {
                queue.startLease(jobId, now);
                continue;
            }
            if (claim.get().lastSeenAt().plus(properties.leaseTimeout()).isAfter(now)) {
                continue;
            }
            int attempts = claim.get().attempts();
            Outcome outcome = transactionTemplate.execute(status -> recover(jobId, attempts, now));
            switch (outcome) {
                case REQUEUED -> {
                    queue.requeue(jobId);
                    requeued++;
                }
                case TIMED_OUT -> {
                    queue.complete(jobId);
                    mattermost.reconFailed(jobId);
                    timedOut++;
                }
                case CLEANED -> {
                    queue.complete(jobId);
                    cleaned++;
                }
                case null -> {}
            }
            log.info(
                    "recon lease expired: jobId={}, attempts={}, outcome={}",
                    jobId,
                    attempts,
                    outcome);
        }
        return new Summary(requeued, timedOut, cleaned);
    }

    private Outcome recover(String jobId, int attempts, Instant now) {
        Optional<ReconstructionJob> found = jobRepository.findByIdForUpdate(jobId);
        if (found.isEmpty()) {
            return Outcome.CLEANED;
        }
        ReconstructionJob job = found.get();
        if (job.getStatus() == ReconstructionStatus.QUEUED) {
            // claim 도중 끊겨 DB는 QUEUED인데 대기열에 없는 경우. 대기열로 되돌린다.
            return Outcome.REQUEUED;
        }
        if (job.getStatus() != ReconstructionStatus.RUNNING) {
            return Outcome.CLEANED;
        }
        if (attempts < properties.maxAttempts()) {
            job.requeue();
            failOpenStages(jobId, "lease expired, requeued (attempt " + attempts + ")");
            return Outcome.REQUEUED;
        }
        String detail = "lease expired after " + attempts + " attempts";
        job.fail(now, TIMEOUT_FAIL_CODES, detail, null, null);
        failOpenStages(jobId, detail);
        afterTimeout(job, now);
        return Outcome.TIMED_OUT;
    }

    /**
     * GPU 대기열에서 {@code queueTimeout} 넘게 기다린 작업을 FAILED(TIMEOUT)로 끝낸다(S15P31B204-528).
     *
     * <p>claim과의 경합: 둘 다 작업 행을 잠그고 상태를 다시 본다. claim이 먼저 RUNNING으로 바꿨으면 여기서 건너뛰고, 여기가 먼저 FAILED로
     * 바꿨으면 claim이 건너뛴다(api {@code ReconstructionWorkerService.start}). 조회와 잠금 사이에 회수·재시도로 다시 들어온
     * 작업은 {@code updated_at}이 새로 바뀌어 건너뛴다.
     *
     * <p>GPU 워커가 일하고 있으면(처리 중 작업 중 하나라도 lease 안에 claim·진행 보고가 있으면) 아무것도 끝내지 않는다. 이 시간 초과는 아무도 가져가지
     * 않는 경우(Pod 꺼짐·워커 미실행)를 막으려는 것이고, Pod이 정상인데 작업이 몰려 밀린 대기(운영 워커 3개 × 약 8분)는 기다리면 처리된다(인프라 확인
     * 2026-11-02: 8건 넘게 몰리면 20분을 넘길 수 있다).
     *
     * @return 끝낸 작업 수
     */
    public int timeOutUnclaimed() {
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        if (gpuWorking(now)) {
            return 0;
        }
        Instant waitingBefore = now.minus(properties.queueTimeout());
        int timedOut = 0;
        for (String jobId : jobRepository.findIdsAwaitingGpuSince(waitingBefore)) {
            Boolean failed =
                    transactionTemplate.execute(status -> failUnclaimed(jobId, waitingBefore, now));
            if (!Boolean.TRUE.equals(failed)) {
                continue;
            }
            queue.removeWaiting(jobId);
            mattermost.reconFailed(jobId);
            timedOut++;
            log.info(
                    "recon queue timed out: jobId={}, waited>={}",
                    jobId,
                    properties.queueTimeout());
        }
        return timedOut;
    }

    /** 처리 중 목록에 lease가 살아 있는(마지막 claim·진행 보고가 {@code leaseTimeout} 안인) 작업이 있는가. */
    private boolean gpuWorking(Instant now) {
        Instant aliveAfter = now.minus(properties.leaseTimeout());
        for (String jobId : queue.processing()) {
            Optional<LeaseQueue.Claim> claim = queue.claim(jobId);
            if (claim.isPresent()
                    && claim.get().lastSeenAt() != null
                    && claim.get().lastSeenAt().isAfter(aliveAfter)) {
                return true;
            }
        }
        return false;
    }

    private boolean failUnclaimed(String jobId, Instant waitingBefore, Instant now) {
        Optional<ReconstructionJob> found = jobRepository.findByIdForUpdate(jobId);
        if (found.isEmpty()
                || !found.get().awaitingGpu()
                || !found.get().getUpdatedAt().isBefore(waitingBefore)) {
            return false;
        }
        ReconstructionJob job = found.get();
        job.failUnclaimed(
                now,
                TIMEOUT_FAIL_CODES,
                "not claimed for " + properties.queueTimeout().toMinutes() + " minutes");
        afterTimeout(job, now);
        return true;
    }

    /**
     * 추출 대기에서 끝내야 할 작업을 FAILED(TIMEOUT)로 끝낸다(S15P31B204-593). 지금 lease를 잡은 추출 워커가 없는 작업 중, 시도를 다
     * 썼거나 접수·마지막 claim 뒤 {@code extractQueueTimeout} 넘게 아무도 가져가지 않은 것. api는 이 두 경우를 다음 claim 때만
     * 처리하므로, 추출 워커가 하나도 없으면 사용자 작업이 실패 알림 없이 계속 대기했다.
     *
     * <p>claim과의 경합: 둘 다 작업 행을 잠그고 조건을 다시 본다. claim이 먼저 가져갔으면 {@code extract_claimed_at}이 새로 바뀌어
     * 건너뛰고, 여기가 먼저 FAILED로 바꿨으면 claim의 조회 조건({@code status=QUEUED})에서 빠진다.
     *
     * <p>추출은 1건에 수십 초라 작업이 몰려 밀린 대기로 20분을 넘기는 일은 드물다. 그래서 GPU 대기(528)와 달리 "워커가 일하는 중이면 끝내지 않는다"는
     * 조건을 두지 않는다.
     *
     * @return 끝낸 작업 수
     */
    public int timeOutExtraction() {
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        Instant staleBefore = now.minus(properties.extractLeaseTimeout());
        Instant waitingBefore = now.minus(properties.extractQueueTimeout());
        int timedOut = 0;
        for (String jobId :
                jobRepository.findIdsExtractionToTimeOut(
                        staleBefore, properties.extractMaxAttempts(), waitingBefore)) {
            String detail =
                    transactionTemplate.execute(
                            status -> failExtraction(jobId, staleBefore, waitingBefore, now));
            if (detail == null) {
                continue;
            }
            mattermost.reconFailed(jobId);
            timedOut++;
            log.info("frame extraction timed out: jobId={}, {}", jobId, detail);
        }
        return timedOut;
    }

    /** 잠근 뒤 조건을 다시 보고 끝낸다. 끝냈으면 사유, 아니면 null. */
    private String failExtraction(
            String jobId, Instant staleBefore, Instant waitingBefore, Instant now) {
        Optional<ReconstructionJob> found = jobRepository.findByIdForUpdate(jobId);
        if (found.isEmpty() || !found.get().awaitingFrames()) {
            return null;
        }
        ReconstructionJob job = found.get();
        if (job.getExtractClaimedAt() != null && !job.getExtractClaimedAt().isBefore(staleBefore)) {
            return null;
        }
        String detail;
        if (job.getExtractAttempts() >= properties.extractMaxAttempts()) {
            detail = "extract lease expired after " + job.getExtractAttempts() + " attempts";
        } else if (job.getUpdatedAt().isBefore(waitingBefore)) {
            detail =
                    "frame extraction not claimed for "
                            + properties.extractQueueTimeout().toMinutes()
                            + " minutes";
        } else {
            return null;
        }
        job.failExtraction(now, TIMEOUT_FAIL_CODES, detail);
        failOpenStages(jobId, detail);
        // api FrameExtractionService.fail과 같은 뒷정리: 원본 보관 24h + 올렸을 수 있는 시도별 묶음 삭제 예약 + 실패 알림
        uploadRepository.scheduleRetention(
                job.getFaceUploadId(), now.plus(properties.failedUploadRetention()));
        for (int attempt = 1; attempt <= job.getExtractAttempts(); attempt++) {
            deletionLogRepository.save(
                    DataDeletionLog.pending(
                            job.getUserId(),
                            DataDeletionLog.TARGET_FACE_UPLOAD_FRAMES,
                            job.getFaceUploadId(),
                            ReconstructionOutputKeys.framesBundle(
                                    job.getUserId(), job.getFaceUploadId(), attempt),
                            DataDeletionLog.REASON_RETENTION_POLICY));
        }
        notificationRepository.save(
                Notification.of(job.getUserId(), NotificationType.RECON_FAILED, job.getId()));
        return detail;
    }

    /**
     * DB에는 GPU 대기(프레임 준비됨)인데 Redis 대기열({@code recon:jobs})에도 처리 중 목록에도 없는 작업을 다시
     * 넣는다(S15P31B204-593). api는 커밋 뒤에 대기열에 넣으므로, 커밋 직후 api가 죽거나 Redis 오류가 나면 작업이 대기열에서 빠진 채 남는다.
     * 그러면 어느 워커도 가져가지 못하고, GPU 워커가 일하는 동안에는 528 시간 초과도 걸리지 않아 사용자가 끝없이 기다린다.
     *
     * <p>막 커밋돼 api가 넣는 중인 작업과 겹치지 않게 마지막 변경 뒤 {@link #QUEUE_RESTORE_GRACE}가 지난 것만 본다. 그래도 겹쳐 두 번
     * 들어가면 claim이 중복을 건너뛴다.
     *
     * @return 다시 넣은 작업 수
     */
    public int restoreGpuQueue() {
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        List<String> candidates =
                jobRepository.findIdsAwaitingGpuSince(now.minus(QUEUE_RESTORE_GRACE));
        if (candidates.isEmpty()) {
            return 0;
        }
        Set<String> queued = new HashSet<>(queue.waiting());
        queued.addAll(queue.processing());
        int restored = 0;
        for (String jobId : candidates) {
            if (queued.contains(jobId)) {
                continue;
            }
            queue.enqueue(jobId);
            restored++;
            log.warn("recon job missing from queue, re-enqueued: jobId={}", jobId);
        }
        return restored;
    }

    /**
     * 단계별 기록(관리자 화면, S15P31B204-652)에서 회수·시간 초과로 끝난 작업의 열린 단계를 실패로 닫는다. 같은 작업 행 잠금 안이다. api {@code
     * ReconstructionStageRecorder.failOpen}과 같은 규칙이다.
     */
    private void failOpenStages(String jobId, String detail) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        stageRepository
                .findAllByJobIdAndStatus(jobId, JobStageStatus.RUNNING)
                .forEach(row -> row.fail(now, detail, null));
    }

    /** TIMEOUT 실패의 뒷정리: 시도별 출력 삭제 예약 + 원본 보관 24h + 실패 알림. */
    private void afterTimeout(ReconstructionJob job, Instant now) {
        for (int attempt = 1; attempt <= properties.maxAttempts(); attempt++) {
            for (String key : ReconstructionOutputKeys.all(job.getUserId(), job.getId(), attempt)) {
                deletionLogRepository.save(
                        DataDeletionLog.pending(
                                job.getUserId(),
                                DataDeletionLog.TARGET_RECON_OUTPUT,
                                job.getId(),
                                key,
                                DataDeletionLog.REASON_RETENTION_POLICY));
            }
        }
        uploadRepository.scheduleRetention(
                job.getFaceUploadId(), now.plus(properties.failedUploadRetention()));
        notificationRepository.save(
                Notification.of(job.getUserId(), NotificationType.RECON_FAILED, job.getId()));
    }
}
