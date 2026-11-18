package com.preface.api.facemodel.dto;

import java.time.Instant;
import java.util.List;

/** API-HIS-01. 공통 페이지 형식. */
public record FaceModelListResponse(List<Item> items, int page, int size, long totalElements) {

    /**
     * @param thumbnailUrl Before 정면 썸네일 presigned GET(10분). 워커가 썸네일을 안 만들었으면 {@code null}
     * @param simulationCount 빈 시안·삭제된 시안 제외
     */
    public record Item(
            String faceModelId,
            String title,
            String thumbnailUrl,
            Instant createdAt,
            long simulationCount) {

        @Override
        public String toString() {
            return "Item[faceModelId=" + faceModelId + ", thumbnailUrl=<redacted>]";
        }
    }
}
