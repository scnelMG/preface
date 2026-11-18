package com.preface.api.simulation.dto;

import java.time.Instant;
import java.util.List;

/** API-HIS-06(최근 기록). 공통 페이지 형식. 시안 썸네일은 없다. */
public record SimulationListResponse(List<Item> items, int page, int size, long totalElements) {

    /**
     * @param changedParts 기본값과 다른 가중치가 있는 부위(예: {@code ["NOSE"]}), {@code sort_order} 순
     */
    public record Item(
            String simulationId,
            String faceModelId,
            String title,
            List<String> changedParts,
            Instant createdAt,
            Instant updatedAt) {}
}
