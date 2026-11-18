package com.preface.api.notification.dto;

import java.time.Instant;

/** API-NOTI-01 목록 항목. */
public record NotificationResponse(
        String notificationId,
        String type,
        String title,
        String body,
        Target target,
        Instant readAt,
        Instant createdAt) {

    public record Target(String kind, String id) {}
}
