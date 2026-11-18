package com.preface.api.simulation.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 시안 목록의 {@code changedParts}(API-HIS-06) 계산. 시안 썸네일이 없어서 이름·수정일과 함께 "어느 부위를 바꿨는지"로 구분한다.
 *
 * <p>가중치가 그 항목의 기본값과 다르면 바뀐 것으로 본다. 부위 순서는 morph 파라미터 {@code sort_order}를 따른다. 지금 스키마에 없는
 * code(비활성·모르는 항목)는 무시한다.
 */
public final class ChangedParts {

    /** 기본값과 같다고 보는 오차. 슬라이더 step(0.05)보다 충분히 작다. */
    private static final double EPSILON = 1e-9;

    private ChangedParts() {}

    /** morph 항목 하나가 속한 부위와 기본값. */
    public record PartOf(String part, double defaultValue) {}

    /**
     * @param weights 시안의 현재 가중치(누락 키 = 기본값)
     * @param partsByCode {@code sort_order} 순 code → 부위
     */
    public static List<String> of(Map<String, Double> weights, Map<String, PartOf> partsByCode) {
        Set<String> parts = new LinkedHashSet<>();
        for (Map.Entry<String, PartOf> e : partsByCode.entrySet()) {
            Double value = weights.get(e.getKey());
            if (value != null && Math.abs(value - e.getValue().defaultValue()) > EPSILON) {
                parts.add(e.getValue().part());
            }
        }
        return new ArrayList<>(parts);
    }
}
