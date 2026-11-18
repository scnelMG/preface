package com.preface.api.consult.dto;

import com.preface.api.simulation.dto.EyeEditState;
import java.util.List;
import java.util.Map;

/**
 * 반영 결과 스냅숏. API-EDIT-05가 {@code change_request.request_json.applyResult}에 저장하고 API-CON-02가 그대로
 * 돌려준다.
 *
 * @param seq 반영으로 생긴 {@code morph_change.seq}
 */
public record ApplyResult(
        String summary,
        List<AppliedChange> applied,
        List<SkippedClause> skipped,
        int seq,
        boolean limited,
        EyeEditState eyeBefore,
        EyeEditState eyeAfter,
        Map<String, Double> eyeLimits) {}
