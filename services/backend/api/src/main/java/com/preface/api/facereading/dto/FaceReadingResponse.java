package com.preface.api.facereading.dto;

import java.time.Instant;
import tools.jackson.databind.JsonNode;

/**
 * AI 관상 상태·결과(API 가안, S15P31B204-438).
 *
 * @param status PENDING · DONE · FAILED. FAILED면 다시 요청할 수 있다(사진이 남아 있을 때)
 * @param result DONE일 때만: {@code {title, parts[{part, name, reading}], overall, advice[{part,
 *     change, effect}]}}
 */
public record FaceReadingResponse(
        String readingId, String jobId, String status, JsonNode result, Instant createdAt) {}
