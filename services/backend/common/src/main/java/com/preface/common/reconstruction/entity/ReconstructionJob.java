package com.preface.common.reconstruction.entity;

import com.preface.common.jpa.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

/**
 * 3D 복원 작업. 상태 전이는 이 클래스의 메서드로만 바꾼다. 허용되지 않은 전이는 {@link IllegalStateException}이다(호출하는 서비스가 먼저 상태를
 * 확인하고 에러 코드로 바꾼다).
 *
 * <p>{@code face_upload}·{@code user}는 ID 컬럼으로만 둔다. 업로드 엔티티는 업로드 기능(CAP)이 만들고, 여기서는 작업 처리에 필요한 것만
 * 다룬다.
 *
 * <p>JSON 컬럼({@code fail_codes}, {@code quality_report})은 서비스가 직렬화한 문자열로 둔다. 내용을 서버가 해석하지 않고 저장·전달만
 * 하기 때문이다.
 */
@Getter
@Entity
@Table(name = "reconstruction_job")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ReconstructionJob extends BaseTimeEntity {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(name = "user_id", nullable = false, length = 36, updatable = false)
    private String userId;

    @Column(name = "face_upload_id", nullable = false, length = 36, updatable = false)
    private String faceUploadId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ReconstructionStatus status;

    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private ReconstructionStage stage;

    @Column(length = 30)
    private String engine;

    /** 프레임 추출 완료 시각. NULL이면 추출 대기(QUEUED지만 GPU 대기열에 아직 없음), 채워지면 GPU 대기열(V8). */
    private Instant framesReadyAt;

    @Column(length = 64)
    private String extractWorkerId;

    private Instant extractClaimedAt;

    /** 추출 시도 수. 프레임 key 경로({@code frames/a{시도}/})에 들어가 늦게 온 이전 시도의 업로드가 새 시도와 섞이지 않는다. */
    @Column(nullable = false)
    private int extractAttempts;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "fail_codes")
    private String failCodesJson;

    @Column(name = "fail_detail", length = 1000)
    private String failDetail;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "quality_report")
    private String qualityReportJson;

    private Instant startedAt;

    private Instant finishedAt;

    private Integer durationMs;

    public static ReconstructionJob queue(String userId, String faceUploadId) {
        ReconstructionJob job = new ReconstructionJob();
        job.userId = userId;
        job.faceUploadId = faceUploadId;
        job.status = ReconstructionStatus.QUEUED;
        return job;
    }

    /**
     * 추출 워커가 가져갔다(INT-EXT-01). 프레임이 아직 없을 때만. 상태는 QUEUED 그대로지만 화면 1단계(프레임 고르기)로 보이게 단계를 남긴다. 추출
     * lease가 끝나 다른 워커가 다시 가져가도 같은 단계다.
     */
    public void claimExtraction(String workerId, Instant now) {
        requireAwaitingFrames();
        extractWorkerId = workerId;
        extractClaimedAt = now;
        extractAttempts++;
        stage = ReconstructionStage.FRAME_SELECT;
    }

    /**
     * 추출이 일시적인 오류(INTERNAL)로 실패해 다시 대기열에 돌려놓는다(S15P31B204-594). lease를 바로 풀어 다음 claim이 가져가고, 시도 수는
     * 그대로 두어 {@code extractMaxAttempts}까지만 다시 한다. 상태는 QUEUED·추출 대기 그대로다.
     */
    public void releaseExtraction() {
        requireAwaitingFrames();
        extractWorkerId = null;
        extractClaimedAt = null;
    }

    /** 지금 이 워커·시도의 추출인지(lease로 다른 워커에 다시 넘어갔으면 false). */
    public boolean extractionOwnedBy(String workerId, int attempt) {
        return awaitingFrames() && workerId.equals(extractWorkerId) && attempt == extractAttempts;
    }

    /**
     * 프레임 저장 완료(INT-EXT-03 성공). 이제 GPU 대기열에 들어간다. 추출 명령이 입력 품질까지 통과시켰으므로 2단계(입력 품질 확인)로 둔다. GPU가 꺼져
     * 있어도 "추출은 끝났다"가 상태 API에 드러난다.
     */
    public void framesReady(Instant now) {
        requireAwaitingFrames();
        framesReadyAt = now;
        stage = ReconstructionStage.QUALITY_CHECK;
    }

    /** 추출 단계 실패(INT-EXT-03 실패·추출 lease 초과). GPU가 시작하기 전이라 QUEUED에서 바로 FAILED로 간다. */
    public void failExtraction(Instant now, String failCodesJson, String failDetail) {
        requireAwaitingFrames();
        status = ReconstructionStatus.FAILED;
        this.failCodesJson = failCodesJson;
        this.failDetail = failDetail;
        finish(now, null, null);
    }

    /**
     * GPU 대기열에서 아무도 가져가지 않아 시간 초과로 끝낸다(S15P31B204-528). 프레임은 준비됐지만 워커가 시작하기 전이라 QUEUED에서 바로 FAILED로
     * 간다.
     */
    public void failUnclaimed(Instant now, String failCodesJson, String failDetail) {
        if (!awaitingGpu()) {
            throw new IllegalStateException("job " + id + " is not awaiting a GPU worker");
        }
        status = ReconstructionStatus.FAILED;
        this.failCodesJson = failCodesJson;
        this.failDetail = failDetail;
        finish(now, null, null);
    }

    /** 프레임이 준비돼 GPU 대기열에 있다(처음이든 회수·재시도로 돌아왔든). */
    public boolean awaitingGpu() {
        return status == ReconstructionStatus.QUEUED && framesReadyAt != null;
    }

    public boolean awaitingFrames() {
        return status == ReconstructionStatus.QUEUED && framesReadyAt == null;
    }

    /**
     * 차례를 기다리는 대기열(S15P31B204-729). 추출 중·실행 중·끝난 작업은 null.
     *
     * @param extractStaleBefore 지금 − 추출 lease 시간
     */
    public ReconstructionWaitQueue waitQueue(Instant extractStaleBefore) {
        return ReconstructionWaitQueue.of(
                status, framesReadyAt, extractClaimedAt, extractStaleBefore);
    }

    private void requireAwaitingFrames() {
        if (!awaitingFrames()) {
            throw new IllegalStateException("job " + id + " is not awaiting frames");
        }
    }

    /** 워커가 가져갔다(INT-REC-01). 재큐잉 뒤 다시 가져가도 처음 시작 시각을 유지한다. */
    public void start(Instant now) {
        requireStatus(ReconstructionStatus.QUEUED);
        status = ReconstructionStatus.RUNNING;
        if (startedAt == null) {
            startedAt = now;
        }
    }

    /** 진행 보고(INT-REC-02). 엔진 이름은 보낸 경우에만 바꾼다. */
    public void progress(ReconstructionStage stage, String engine) {
        requireStatus(ReconstructionStatus.RUNNING);
        this.stage = stage;
        if (engine != null) {
            this.engine = engine;
        }
        touch();
    }

    /**
     * lease 만료로 회수해 대기열로 돌린다. 엔진은 지운다(다른 워커가 처음부터 한다). 프레임은 남아 있으므로 단계는 추출이 끝난 2단계로 되돌린다. 프레임 없이
     * 들어온 작업(추출 도입 전)은 단계를 지운다.
     */
    public void requeue() {
        requireStatus(ReconstructionStatus.RUNNING);
        status = ReconstructionStatus.QUEUED;
        stage = framesReadyAt == null ? null : ReconstructionStage.QUALITY_CHECK;
        engine = null;
    }

    /** 탈퇴·얼굴 동의 철회로 취소. 워커의 이후 보고는 REC_020으로 거절되어 결과가 저장되지 않는다(FN-AUTH-04 수용 2). */
    public void cancel(Instant now) {
        if (!status.inProgress()) {
            throw new IllegalStateException("job " + id + " is " + status + ", not in progress");
        }
        status = ReconstructionStatus.CANCELED;
        finishedAt = now;
    }

    public void succeed(Instant now, Integer durationMs, String qualityReportJson) {
        requireStatus(ReconstructionStatus.RUNNING);
        status = ReconstructionStatus.SUCCEEDED;
        stage = ReconstructionStage.FINALIZE;
        finish(now, durationMs, qualityReportJson);
    }

    /** 실패한 단계는 그대로 남긴다(어디서 실패했는지 운영 기록). */
    public void fail(
            Instant now,
            String failCodesJson,
            String failDetail,
            Integer durationMs,
            String qualityReportJson) {
        requireStatus(ReconstructionStatus.RUNNING);
        status = ReconstructionStatus.FAILED;
        this.failCodesJson = failCodesJson;
        this.failDetail = failDetail;
        finish(now, durationMs, qualityReportJson);
    }

    private void finish(Instant now, Integer durationMs, String qualityReportJson) {
        finishedAt = now;
        this.durationMs =
                durationMs != null
                        ? durationMs
                        : startedAt == null
                                ? null
                                : (int) Math.max(0, now.toEpochMilli() - startedAt.toEpochMilli());
        if (qualityReportJson != null) {
            this.qualityReportJson = qualityReportJson;
        }
    }

    private void requireStatus(ReconstructionStatus expected) {
        if (status != expected) {
            throw new IllegalStateException("job " + id + " is " + status + ", not " + expected);
        }
    }
}
