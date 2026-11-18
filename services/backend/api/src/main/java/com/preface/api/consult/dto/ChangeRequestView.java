package com.preface.api.consult.dto;

import java.util.List;

/**
 * 변경 요청(v2). API-CON-01 응답·API-CON-02 항목의 {@code changeRequest}.
 *
 * @param status {@code COMPLETE}(반영 전) 또는 {@code APPLIED}
 */
public record ChangeRequestView(
        String requestId,
        String status,
        String schemaVersion,
        List<EditAction> actions,
        List<SkippedClause> skipped) {}
