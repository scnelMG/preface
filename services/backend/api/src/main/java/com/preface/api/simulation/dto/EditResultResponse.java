package com.preface.api.simulation.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * API-EDIT-04·06·07·08 응답. 모든 편집 응답에 {@code stateVersion}·{@code currentSeq}·{@code canUndo}·{@code
 * canRedo}를 담는다. {@code clamped}는 EDIT-04만, {@code undoneSummary}는 EDIT-06만, {@code redoneSummary}는
 * EDIT-08만 채운다(빈 필드는 내보내지 않는다).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EditResultResponse(
        MorphState morphState,
        int stateVersion,
        int currentSeq,
        Boolean clamped,
        boolean canUndo,
        boolean canRedo,
        String undoneSummary,
        String redoneSummary) {}
