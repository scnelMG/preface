package com.preface.api.notification.controller;

import com.preface.api.global.security.AuthPrincipal;
import com.preface.api.notification.dto.NotificationListResponse;
import com.preface.api.notification.dto.ReadNotificationsRequest;
import com.preface.api.notification.dto.UnreadCountResponse;
import com.preface.api.notification.service.NotificationService;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 알림 API(API-NOTI-01·02). */
@RestController
@RequestMapping("/api/v1/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationService notificationService;

    /** API-NOTI-01. size는 1~50으로 맞춘다. */
    @GetMapping
    public ApiResponse<NotificationListResponse> list(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(notificationService.list(principal.subject(), page, size));
    }

    /** API-NOTI-02 */
    @PostMapping("/read")
    public ApiResponse<UnreadCountResponse> read(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody ReadNotificationsRequest request) {
        return ApiResponse.ok(
                new UnreadCountResponse(
                        notificationService.markRead(principal.subject(), request)));
    }
}
