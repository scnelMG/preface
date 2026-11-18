package com.preface.api.admin.dto;

import java.time.Instant;
import java.util.List;

/**
 * {@code GET /api/v1/admin/reconstructions/queue} 응답(S15P31B204-652).
 *
 * <p>{@code position}은 사용자 화면의 queuePosition과 같은 기준이다(S15P31B204-729): 목록마다 1부터 따로 센다. 추출 대기는 지금 추출
 * 워커가 가져갈 수 있는 작업을 {@code created_at, id} 순으로, GPU 대기는 {@code queuedAt(updated_at), id} 순으로.
 *
 * @param extract 프레임 추출 대기(추출 중 포함, 추출 중이면 {@code position} null). {@code queuedAt} = 접수 시각
 * @param gpu GPU 대기. {@code queuedAt} = GPU 대기열에 들어온 시각({@code updated_at}: 프레임 준비 또는 회수·재시도로 돌아온
 *     시각)
 */
public record AdminJobQueueResponse(List<Entry> extract, List<Entry> gpu) {

    public record Entry(
            Long position, String jobId, String userId, Instant queuedAt, long waitedMs) {}
}
