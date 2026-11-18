package com.preface.api.consult.dto;

import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.MorphState;
import java.util.List;
import java.util.Map;

/**
 * API-EDIT-05 응답({@code contracts/edit/consult-apply-v1.md}). FE는 이 실제값으로 After·슬라이더·변경 카드를 맞춘다.
 *
 * @param seq 반영으로 생긴 이력 순번(계약 이름). {@code currentSeq}와 같다(다른 편집 응답과 맞춤)
 * @param limited {@code applied[]} 중 하나라도 허용 범위로 줄었는지
 * @param summary 이력 요약(예: "콧대 높이 변경")
 */
public record ApplyChangeRequestResponse(
        MorphState morphState,
        int stateVersion,
        int seq,
        int currentSeq,
        List<AppliedChange> applied,
        EyeEditState eyeBefore,
        EyeEditState eyeAfter,
        Map<String, Double> eyeLimits,
        List<SkippedClause> skipped,
        boolean limited,
        String summary,
        boolean canUndo,
        boolean canRedo) {}
