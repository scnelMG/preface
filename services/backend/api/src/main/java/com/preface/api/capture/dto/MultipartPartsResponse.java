package com.preface.api.capture.dto;

import java.time.Instant;
import java.util.List;

/** 조각 URL 재발급 응답(S15P31B204-506). */
public record MultipartPartsResponse(List<MultipartPartUrl> parts, Instant expiresAt) {}
