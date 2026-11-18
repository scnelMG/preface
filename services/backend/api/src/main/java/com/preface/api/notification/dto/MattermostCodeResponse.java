package com.preface.api.notification.dto;

import java.time.Instant;

/**
 * 확인 코드를 보냈다(S15P31B204-476).
 *
 * @param username 코드를 보낸 아이디(정규화한 값)
 * @param expiresAt 코드 만료 시각
 * @param resendAvailableAt 코드를 다시 받을 수 있는 시각
 */
public record MattermostCodeResponse(
        String username, Instant expiresAt, Instant resendAvailableAt) {}
