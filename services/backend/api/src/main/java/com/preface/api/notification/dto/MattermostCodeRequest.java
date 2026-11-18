package com.preface.api.notification.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Mattermost 확인 코드 요청(S15P31B204-476).
 *
 * @param username Mattermost 아이디. 앞의 {@code @}는 떼고 받는다
 * @param agreed 완료 알림 고지에 동의했는지. true여야 한다
 */
public record MattermostCodeRequest(
        @NotBlank @Size(max = 64) String username, @AssertTrue Boolean agreed) {}
