package com.preface.api.simulation.dto;

import java.util.Map;

/** 승인된 모델만 EDIT-03에 내리는 코 효과별 상대 범위와 엔진 버전. */
public record NoseCapabilities(
        String modelVersion,
        String rigVersion,
        String engineVersion,
        Map<String, Range> supported) {
    public record Range(double min, double max) {}
}
