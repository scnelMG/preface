package com.preface.api.reconstruction.dto;

import java.time.Instant;
import java.util.List;

/**
 * API-REC-02·03 응답.
 *
 * @param stage 아직 단계가 없으면(접수 직후 추출 대기 등) null
 * @param stageIndex 화면 4단계 중 현재 순번(1~4). stage가 null이면 null
 * @param queuePosition {@code waiting}일 때 그 작업이 기다리는 대기열(추출 대기 또는 GPU 대기) 안 순번(1부터), 그 외 null
 * @param failCodes FAILED일 때 실패 코드, 그 외 빈 목록
 * @param faceModelId SUCCEEDED이고 3D가 지워지지 않았을 때
 * @param waiting 차례를 기다리는 중(추출 대기 또는 GPU 대기, S15P31B204-729). 추출 중·실행 중·끝난 작업은 false. 기다리는 단계는
 *     {@code stageIndex}(null이면 1단계)
 * @param waitingSince {@code waiting}일 때 그 대기열에서 기다리기 시작한 시각, 그 외 null
 */
public record ReconstructionStatusResponse(
        String jobId,
        String status,
        String stage,
        Integer stageIndex,
        Long queuePosition,
        List<String> failCodes,
        String faceModelId,
        Instant createdAt,
        Instant startedAt,
        Instant finishedAt,
        boolean waiting,
        Instant waitingSince) {}
