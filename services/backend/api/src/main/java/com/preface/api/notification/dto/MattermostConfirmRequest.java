package com.preface.api.notification.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Mattermost 확인 코드 입력(S15P31B204-476). */
public record MattermostConfirmRequest(@NotBlank @Size(max = 10) String code) {}
