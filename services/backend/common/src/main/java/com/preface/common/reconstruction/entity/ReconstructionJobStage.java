package com.preface.common.reconstruction.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

/**
 * 복원 작업의 단계별 기록(V27, S15P31B204-651). 관리자 화면이 구간별 소요 시간과 실패 단계를 보여 줄 때 쓴다.
 *
 * <p>단계를 시작할 때 {@link #start}로 행을 만들고, 끝나면 {@link #succeed}·{@link #fail}로 닫는다. 같은 단계를 다시 하면(추출 재시도
 * 등) {@code attempt}를 올려 새 행을 만든다. 작업이 물리 삭제되면 DB CASCADE로 함께 지워진다.
 */
@Getter
@Entity
@Table(name = "reconstruction_job_stage")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ReconstructionJobStage {

    private static final int DETAIL_MAX = 1000;

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(name = "job_id", nullable = false, length = 36, updatable = false)
    private String jobId;

    @Column(nullable = false, updatable = false)
    private int attempt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30, updatable = false)
    private PipelineStage stage;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private JobStageStatus status;

    @Column(nullable = false, updatable = false)
    private Instant startedAt;

    private Instant finishedAt;

    private Integer durationMs;

    @Column(length = 64)
    private String workerId;

    /** 내부 상세. 관리자 화면에만 보인다 */
    @Column(length = DETAIL_MAX)
    private String detail;

    @Column(length = 500)
    private String logObjectKey;

    public static ReconstructionJobStage start(
            String jobId, PipelineStage stage, int attempt, String workerId, Instant startedAt) {
        if (attempt < 1) {
            throw new IllegalArgumentException("attempt는 1부터다");
        }
        ReconstructionJobStage row = new ReconstructionJobStage();
        row.jobId = jobId;
        row.stage = stage;
        row.attempt = attempt;
        row.workerId = workerId;
        row.startedAt = startedAt;
        row.status = JobStageStatus.RUNNING;
        return row;
    }

    public void succeed(Instant now) {
        finish(JobStageStatus.SUCCEEDED, now, null, null);
    }

    /** 실패로 닫는다. {@code detail}은 1000자로 자른다. */
    public void fail(Instant now, String detail, String logObjectKey) {
        finish(JobStageStatus.FAILED, now, detail, logObjectKey);
    }

    public boolean isRunning() {
        return status == JobStageStatus.RUNNING;
    }

    private void finish(JobStageStatus result, Instant now, String detail, String logObjectKey) {
        status = result;
        finishedAt = now;
        long millis = Math.max(0, Duration.between(startedAt, now).toMillis());
        durationMs = (int) Math.min(Integer.MAX_VALUE, millis);
        this.detail =
                detail == null || detail.length() <= DETAIL_MAX
                        ? detail
                        : detail.substring(0, DETAIL_MAX);
        this.logObjectKey = logObjectKey;
    }
}
