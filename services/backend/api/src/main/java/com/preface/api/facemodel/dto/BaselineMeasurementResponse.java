package com.preface.api.facemodel.dto;

import java.util.List;

public record BaselineMeasurementResponse(Status status, List<Observation> observations) {
    public enum Status {
        AVAILABLE,
        DEFERRED
    }

    public record Observation(
            String code,
            String label,
            String definition,
            String unit,
            String quality,
            double lower,
            double upper,
            String sourceUrl) {}
}
