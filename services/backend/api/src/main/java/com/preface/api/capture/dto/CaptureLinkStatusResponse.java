package com.preface.api.capture.dto;

import java.time.Instant;

/**
 * API-QR-03 응답.
 *
 * @param expiresAt WAITING이면 QR 만료, CONNECTED 이후면 업로드 전용 세션 만료. 시간이 지나 기록이 사라진 EXPIRED면 {@code
 *     null}
 * @param jobId UPLOADED일 때 복원 작업 ID
 */
public record CaptureLinkStatusResponse(
        String linkId, CaptureLinkStatus status, Instant expiresAt, String jobId) {}
