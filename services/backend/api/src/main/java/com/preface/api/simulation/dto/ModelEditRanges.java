package com.preface.api.simulation.dto;

import java.util.Map;

/** 해당 시안의 모델에서 지원하는 범위. 눈 키는 엔진의 트임·모양별 높이 키를 사용한다. */
public record ModelEditRanges(Map<String, Range> weights, Map<String, Range> eyes) {
    public record Range(double min, double max) {}
}
