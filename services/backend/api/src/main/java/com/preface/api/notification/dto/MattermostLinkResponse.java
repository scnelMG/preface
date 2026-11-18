package com.preface.api.notification.dto;

import java.time.Instant;

/** 등록된 Mattermost 아이디(S15P31B204-476). */
public record MattermostLinkResponse(String username, Instant linkedAt) {}
