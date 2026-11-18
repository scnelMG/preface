package com.preface.api.admin.dto;

import java.time.Instant;
import java.util.List;

/** 관리자: 회원별 3D 목록(S15P31B204-653). 관리자 API 공통 페이지 형식. 삭제된 3D도 포함한다. */
public record AdminFaceModelListResponse(
        List<Item> items, int page, int size, long totalElements, int totalPages) {

    /**
     * @param videoDurationMs 원본 영상 길이({@code face_upload.duration_ms})
     * @param jobStatus 복원 작업 상태({@code reconstruction_job.status} 값 그대로)
     * @param simulationCount DB에 남은 시안 수(삭제된·빈 시안 포함)
     * @param deleteScheduledAt 물리 삭제 예정 시각(소프트 삭제 시각 + 보관 기간). 삭제 전이면 {@code null}
     */
    public record Item(
            String faceModelId,
            String jobId,
            Instant createdAt,
            Integer videoDurationMs,
            String jobStatus,
            long simulationCount,
            Instant deletedAt,
            Instant deleteScheduledAt) {}
}
