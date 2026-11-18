package com.preface.api.simulation.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** API-EDIT-01 응답. 부위(part)별 슬라이더 항목과 허용 범위. */
public record MorphParametersResponse(String schemaVersion, List<Part> parts) {

    public record Part(String part, String label, List<Item> items) {}

    public record Item(
            String code,
            String subPart,
            String label,
            double min,
            double max,
            @JsonProperty("default") double defaultValue,
            double step) {}
}
