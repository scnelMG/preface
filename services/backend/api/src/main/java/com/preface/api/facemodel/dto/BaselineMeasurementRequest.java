package com.preface.api.facemodel.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.preface.api.reconstruction.dto.NoseApprovalRequest.Binding;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;

/** 내부 검수 결과 등록용. 리뷰어·정점 번호는 요청이나 저장에 필요 없다. */
public record BaselineMeasurementRequest(
        @NotBlank String schemaVersion, @NotNull @Valid Binding binding, @NotNull Review review) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Review(
            String meshSha256,
            String definition,
            String unit,
            String anatomicalQuality,
            Map<String, List<Double>> observedBounds) {}
}
