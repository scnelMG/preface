package com.preface.common.reconstruction.entity;

import java.time.Duration;
import java.time.Instant;

/**
 * QUEUED 작업이 차례를 기다리는 대기열(S15P31B204-729). 사용자 화면(API-REC-01~03 {@code waiting}·{@code
 * waitingSince}·{@code queuePosition})과 관리자 대기열(API-ADM-05)이 같은 규칙을 쓴다.
 *
 * <ul>
 *   <li>{@link #EXTRACT}: 프레임이 없고({@code frames_ready_at} null) 지금 lease를 잡은 추출 워커가 없다({@code
 *       extract_claimed_at}이 null이거나 lease가 끝남). {@code lockNextAwaitingFrames}가 가져갈 수 있는 행과 같은
 *       조건이다.
 *   <li>{@link #GPU}: 프레임이 준비돼 GPU 워커를 기다린다({@link ReconstructionJob#awaitingGpu()}).
 * </ul>
 *
 * 추출 lease가 살아 있는(추출 중) QUEUED 작업과 RUNNING·끝난 작업은 어느 대기열에도 없다.
 */
public enum ReconstructionWaitQueue {
    EXTRACT,
    GPU;

    /**
     * @param extractStaleBefore 이 시각 전에 가져간 추출은 lease가 끝난 것으로 본다(지금 − 추출 lease 시간)
     * @return 기다리는 대기열, 기다리지 않으면 null
     */
    public static ReconstructionWaitQueue of(
            ReconstructionStatus status,
            Instant framesReadyAt,
            Instant extractClaimedAt,
            Instant extractStaleBefore) {
        if (status != ReconstructionStatus.QUEUED) {
            return null;
        }
        if (framesReadyAt != null) {
            return GPU;
        }
        boolean extractLeaseLive =
                extractClaimedAt != null && !extractClaimedAt.isBefore(extractStaleBefore);
        return extractLeaseLive ? null : EXTRACT;
    }

    /**
     * 이 대기열에서 기다리기 시작한 시각.
     *
     * <ul>
     *   <li>추출 대기, 아무도 안 가져감: 접수 시각({@code created_at})
     *   <li>추출 대기, lease가 끝남: lease가 끝난 시각({@code extract_claimed_at} + 추출 lease 시간). 그때 다시 대기열로
     *       돌아왔다
     *   <li>GPU 대기: {@code updated_at}. 프레임 준비·회수로 GPU 대기열에 들어오며 행이 바뀌고, 기다리는 동안에는 바뀌지 않는다 ({@code
     *       findIdsAwaitingGpuSince}와 같은 기준)
     * </ul>
     */
    public Instant since(
            Instant createdAt,
            Instant updatedAt,
            Instant extractClaimedAt,
            Duration extractLeaseTimeout) {
        return switch (this) {
            case EXTRACT ->
                    extractClaimedAt == null
                            ? createdAt
                            : extractClaimedAt.plus(extractLeaseTimeout);
            case GPU -> updatedAt;
        };
    }
}
