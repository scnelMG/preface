package com.preface.api.notification.dto;

import java.util.List;

/** API-NOTI-01. 공통 페이지 형식 + 안 읽은 개수(헤더 점 표시). */
public record NotificationListResponse(
        List<NotificationResponse> items,
        int page,
        int size,
        long totalElements,
        long unreadCount) {}
