package com.preface.api.admin.dto;

import java.time.Instant;
import java.util.List;

/**
 * {@code GET /api/v1/admin/reconstructions} 목록 한 줄(S15P31B204-652).
 *
 * @param stage 화면 단계({@code reconstruction_job.stage}). 없으면 null
 * @param captureMethod {@code face_upload.capture_method}(WEB_RECORDER | FILE). 예전 업로드는 null
 */
public record AdminJobListItem(
        String jobId,
        String userId,
        String status,
        String stage,
        List<String> failCodes,
        Integer durationMs,
        Instant createdAt,
        Instant finishedAt,
        String captureMethod,
        String deviceModel) {}
