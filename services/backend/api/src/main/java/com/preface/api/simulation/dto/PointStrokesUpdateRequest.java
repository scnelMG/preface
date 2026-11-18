package com.preface.api.simulation.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/** 코 제어점 드래그 종료 시 전체 후보 배열을 한 번 보낸다. */
public record PointStrokesUpdateRequest(
        @NotNull Integer stateVersion, @NotNull List<@NotNull PointStroke> pointStrokes) {}
