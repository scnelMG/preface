package com.preface.api.admin.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * {@code GET /api/v1/admin/reconstructions/summary} 응답(S15P31B204-652).
 *
 * @param period {@code today} | {@code 7d} | {@code 30d}
 * @param counts 기간 안에 접수된 작업의 상태별 수. 키는 {@code reconstruction_job.status} 값 그대로(0도 내린다)
 * @param total {@code counts} 합
 * @param failureRate FAILED / (SUCCEEDED + FAILED). 끝난 작업이 없으면 null
 * @param stuckCount 지금 끝나지 않은(QUEUED·RUNNING) 작업 중 마지막 변경이 기준보다 오래된 수. 기간과 무관하다
 */
public record AdminJobSummaryResponse(
        String period,
        Instant from,
        Instant to,
        Map<String, Long> counts,
        long total,
        Double failureRate,
        List<FailCodeCount> failCodes,
        Duration durationMs,
        long stuckCount,
        long stuckThresholdMinutes) {

    public record FailCodeCount(String code, long count) {}

    /**
     * 성공한 작업의 {@code duration_ms} 평균·95백분위. 성공 작업이 없으면 null.
     *
     * @param targetMs 목표(REQ-N-12, 기본 5분)
     */
    public record Duration(Long avg, Long p95, long targetMs) {}
}
