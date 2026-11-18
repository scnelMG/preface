package com.preface.api.reconstruction.service;

import com.preface.common.reconstruction.entity.JobStageStatus;
import com.preface.common.reconstruction.entity.PipelineStage;
import com.preface.common.reconstruction.entity.ReconstructionJobStage;
import com.preface.common.reconstruction.entity.ReconstructionStage;
import com.preface.common.reconstruction.repository.ReconstructionJobStageRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 복원 작업의 단계별 기록({@code reconstruction_job_stage}, S15P31B204-652). 관리자 화면의 구간별 소요 시간·실패 단계에 쓴다. 워커
 * 계약은 바꾸지 않고 지금 오는 보고(추출 claim·결과, GPU 진행·결과)로 행을 열고 닫는다.
 *
 * <p>부르는 쪽이 작업 행을 잠근(FOR UPDATE) 트랜잭션 안에서 부른다. 그래서 같은 작업의 보고가 동시에 와도 한 번에 하나씩 반영되고, 작업 상태와 단계 기록이
 * 함께 커밋되거나 함께 취소된다. 새 트랜잭션(REQUIRES_NEW)으로 따로 쓰지 않는 이유: 단계 행 INSERT의 FK 확인이 바깥 트랜잭션이 잠근 작업 행을 기다려
 * 스스로 막힌다.
 *
 * <p>기록은 부가 정보라 계산 중 예외(값 이상 등)는 로그만 남기고 워커 보고를 막지 않는다. DB 자체가 실패하면 같은 트랜잭션의 작업 변경도 어차피 실패한다.
 *
 * <ul>
 *   <li>진행 보고는 lease를 늘리려고 같은 단계로 반복해서 온다(heartbeat). 같은 단계·같은 시도의 행이 열려 있으면 아무것도 하지 않는다.
 *   <li>단계가 바뀌면 열린 행을 성공으로 닫고 새 행을 연다. 다른 시도(회수·재시도 전)의 행이 남아 있으면 실패로 닫는다.
 *   <li>결과·회수·취소 때는 열린 행을 모두 닫는다.
 * </ul>
 */
@Slf4j
@Component
public class ReconstructionStageRecorder {

    static final int WORKER_ID_MAX = 64;
    static final String DETAIL_SUPERSEDED = "다음 시도로 넘어가 중단";

    private final ReconstructionJobStageRepository repository;
    private final Clock clock;

    public ReconstructionStageRecorder(ReconstructionJobStageRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    /** 추출 워커가 가져갔다(INT-EXT-01). 앞 시도의 열린 행(lease 만료)은 실패로 닫는다. */
    public void extractionStarted(String jobId, int attempt, String workerId) {
        guard(
                jobId,
                () -> {
                    Instant now = now();
                    for (ReconstructionJobStage row : open(jobId)) {
                        row.fail(now, DETAIL_SUPERSEDED, null);
                    }
                    repository.save(
                            ReconstructionJobStage.start(
                                    jobId,
                                    PipelineStage.EXTRACT,
                                    Math.max(1, attempt),
                                    workerId(workerId),
                                    now));
                });
    }

    /**
     * GPU 진행 보고(INT-REC-02). 같은 단계·시도의 행이 열려 있으면 그대로 둔다.
     *
     * @param attempt GPU claim 시도 번호(1부터). 모르면 1
     */
    public void gpuProgress(String jobId, ReconstructionStage stage, int attempt, String workerId) {
        guard(
                jobId,
                () -> {
                    PipelineStage target = toPipeline(stage);
                    int normalized = Math.max(1, attempt);
                    Instant now = now();
                    boolean alreadyOpen = false;
                    for (ReconstructionJobStage row : open(jobId)) {
                        if (row.getStage() == target && row.getAttempt() == normalized) {
                            alreadyOpen = true;
                        } else if (row.getStage() == PipelineStage.EXTRACT
                                || row.getAttempt() != normalized) {
                            row.fail(now, DETAIL_SUPERSEDED, null);
                        } else {
                            row.succeed(now);
                        }
                    }
                    if (!alreadyOpen) {
                        repository.save(
                                ReconstructionJobStage.start(
                                        jobId, target, normalized, workerId(workerId), now));
                    }
                });
    }

    /** 열린 행을 모두 성공으로 닫는다(추출 성공·GPU 성공). */
    public void succeedOpen(String jobId) {
        guard(
                jobId,
                () -> {
                    Instant now = now();
                    open(jobId).forEach(row -> row.succeed(now));
                });
    }

    /**
     * 열린 행을 모두 실패로 닫는다(실패 결과·회수·재시도·취소).
     *
     * @param detail 내부 상세(워커 디버그 메시지·사유). 얼굴 데이터·URL을 넣지 않는다. 1000자로 잘린다
     */
    public void failOpen(String jobId, String detail) {
        guard(
                jobId,
                () -> {
                    Instant now = now();
                    open(jobId).forEach(row -> row.fail(now, detail, null));
                });
    }

    static PipelineStage toPipeline(ReconstructionStage stage) {
        return switch (stage) {
            case FRAME_SELECT -> PipelineStage.FRAME_SELECT;
            case QUALITY_CHECK -> PipelineStage.QUALITY_CHECK;
            case RECONSTRUCT -> PipelineStage.RECONSTRUCT;
            case FINALIZE -> PipelineStage.FINALIZE;
        };
    }

    private List<ReconstructionJobStage> open(String jobId) {
        return repository.findAllByJobIdAndStatus(jobId, JobStageStatus.RUNNING);
    }

    private static String workerId(String workerId) {
        if (workerId == null || workerId.length() <= WORKER_ID_MAX) {
            return workerId;
        }
        return workerId.substring(0, WORKER_ID_MAX);
    }

    private static void guard(String jobId, Runnable action) {
        try {
            action.run();
        } catch (RuntimeException e) {
            log.warn("recon stage record failed, ignored: jobId={}", jobId, e);
        }
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MILLIS);
    }
}
