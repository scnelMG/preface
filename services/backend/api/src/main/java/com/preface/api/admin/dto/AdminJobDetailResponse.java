package com.preface.api.admin.dto;

import java.time.Instant;
import java.util.List;

/**
 * {@code GET /api/v1/admin/reconstructions/{jobId}} 응답(S15P31B204-652).
 *
 * @param segments 구간별 시간. 기록이 없는 구간(이 기능 배포 전 작업 등)은 빠지거나 시각이 null
 * @param slowestSegment 걸린 시간이 가장 긴 구간의 {@code key}. 끝난 구간이 없으면 null
 * @param failure FAILED가 아니면 null
 * @param previousFailures 같은 회원의 이 작업 이전 실패(최근 5건)
 */
public record AdminJobDetailResponse(
        String jobId,
        String userId,
        String status,
        String stage,
        Instant createdAt,
        Instant extractClaimedAt,
        Instant framesReadyAt,
        Instant startedAt,
        Instant finishedAt,
        Integer durationMs,
        int extractAttempts,
        List<Segment> segments,
        String slowestSegment,
        Failure failure,
        List<PreviousFailure> previousFailures,
        Input input,
        String faceModelId) {

    /**
     * 한 구간. 대기 구간({@code EXTRACT_WAIT}·{@code GPU_WAIT})은 {@code attempt}·{@code status}가 null이다.
     *
     * @param key {@code EXTRACT_WAIT} | {@code EXTRACT} | {@code GPU_WAIT} | {@code FRAME_SELECT} |
     *     {@code QUALITY_CHECK} | {@code RECONSTRUCT} | {@code FINALIZE}
     * @param status 단계 기록 상태 RUNNING | SUCCEEDED | FAILED
     */
    public record Segment(
            String key,
            Instant startedAt,
            Instant finishedAt,
            Long durationMs,
            Integer attempt,
            String status) {}

    /**
     * @param stage 실패로 닫힌 마지막 단계(단계 기록이 없으면 작업의 화면 단계, 그것도 없으면 null)
     * @param userMessage BE는 문구를 만들지 않는다(FE 사전). 항상 null
     * @param detail 내부 상세({@code fail_detail}). 관리자만 본다
     */
    public record Failure(String stage, List<String> codes, String userMessage, String detail) {}

    public record PreviousFailure(String jobId, Instant createdAt, List<String> codes) {}

    /**
     * @param quality {@code quality_report} JSON 그대로(없으면 null)
     * @param captureTrace {@code face_upload.capture_trace} JSON 그대로(없으면 null). 웹 녹화만 있고, 원본 영상을
     *     지우면(추출 성공 뒤 삭제 작업) 함께 비워져 null이다
     * @param videoMeta {@code face_upload.video_meta} JSON 그대로(없으면 null)
     */
    public record Input(
            Integer videoDurationMs,
            String captureMethod,
            String deviceModel,
            Integer frameCount,
            Object quality,
            Object captureTrace,
            Object videoMeta) {}
}
