package com.preface.api.notification.dto;

import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * API-NOTI-02. {@code notificationIds} 또는 {@code all=true} 중 하나.
 *
 * @param notificationIds 읽음 처리할 알림 ID(최대 100개 [가정]). 타인·없는 ID는 무시한다
 */
public record ReadNotificationsRequest(
        @Size(max = 100) List<@Size(max = 36) String> notificationIds, Boolean all) {

    public boolean readAll() {
        return Boolean.TRUE.equals(all);
    }
}
