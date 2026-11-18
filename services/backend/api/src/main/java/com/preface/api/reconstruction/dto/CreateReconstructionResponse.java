package com.preface.api.reconstruction.dto;

import java.time.Instant;

/**
 * API-REC-01 응답.
 *
 * @param queuePosition {@code waiting}일 때 그 작업이 기다리는 대기열 안 순번(1부터), 그 외 null
 * @param waiting 차례를 기다리는 중(S15P31B204-729, API-REC-02와 같은 기준)
 * @param waitingSince {@code waiting}일 때 기다리기 시작한 시각, 그 외 null
 */
public record CreateReconstructionResponse(
        String jobId,
        String status,
        Long queuePosition,
        long pollIntervalMs,
        boolean waiting,
        Instant waitingSince) {}
