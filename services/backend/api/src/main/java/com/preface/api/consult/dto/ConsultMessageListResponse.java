package com.preface.api.consult.dto;

import java.time.Instant;
import java.util.List;

/** API-CON-02. 공통 페이지 형식, 메시지 순번(seq) 오름차순. */
public record ConsultMessageListResponse(
        List<Item> items, int page, int size, long totalElements, int conversationAfterSeq) {

    /**
     * @param sender ASSISTANT면 {@code "AI 실장님"}, USER면 null
     * @param applyResult 반영된 변경 요청이 딸린 ASSISTANT 메시지만
     */
    public record Item(
            String messageId,
            String role,
            String sender,
            String content,
            String intent,
            boolean needsClarification,
            List<SendMessageResponse.Option> options,
            String comparisonCode,
            ChangeRequestView changeRequest,
            ApplyResult applyResult,
            Instant createdAt,
            String profileSection) {}
}
