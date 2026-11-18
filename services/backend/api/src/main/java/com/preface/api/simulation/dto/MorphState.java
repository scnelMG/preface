package com.preface.api.simulation.dto;

import java.util.List;
import java.util.Map;

/**
 * 원본 대비 가중치 전체(API 명세서 "공용 구조 MorphState"). After = 원본 + 이 값. 누락 키는 0(원본).
 *
 * <p>{@code simulation.morph_state}·{@code morph_change.state_after}에 이 모양 그대로 JSON으로 저장한다.
 */
public record MorphState(
        String schemaVersion,
        Map<String, Double> weights,
        List<PointStroke> pointStrokes,
        EyeEditState eyeEdit) {
    public MorphState(String schemaVersion, Map<String, Double> weights) {
        this(schemaVersion, weights, List.of(), null);
    }

    public MorphState(
            String schemaVersion, Map<String, Double> weights, List<PointStroke> pointStrokes) {
        this(schemaVersion, weights, pointStrokes, null);
    }
}
