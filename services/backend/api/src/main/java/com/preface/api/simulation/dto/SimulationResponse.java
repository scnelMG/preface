package com.preface.api.simulation.dto;

import java.time.Instant;

/**
 * API-EDIT-02(생성)·EDIT-03(상세) 응답.
 *
 * <p>{@code lastChangeRequest}는 변경 요청(API-CON-01·EDIT-05)이 구현되기 전까지 항상 {@code null}이다.
 */
public record SimulationResponse(
        String simulationId,
        String faceModelId,
        String title,
        MorphState morphState,
        int stateVersion,
        int currentSeq,
        boolean canUndo,
        boolean canRedo,
        boolean hasChanges,
        NoseCapabilities capabilities,
        EyeReview eyeReview,
        String eyePartsSha256,
        EyeCapabilities eyeCapabilities,
        boolean weightShapeSupported,
        ModelEditRanges editRanges,
        boolean editApprovalPending,
        Object lastChangeRequest,
        Instant createdAt,
        Instant updatedAt) {}
