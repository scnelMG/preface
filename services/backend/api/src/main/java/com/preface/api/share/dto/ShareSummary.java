package com.preface.api.share.dto;

import java.time.Instant;

/** API-SHR-02 항목. 토큰·링크는 다시 주지 않는다(DB에 해시만 있다). */
public record ShareSummary(
        String shareId, Instant createdAt, Instant expiresAt, Instant revokedAt) {}
