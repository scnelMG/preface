package com.preface.api.facemodel.controller;

import com.preface.api.facemodel.dto.BaselineMeasurementRequest;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse;
import com.preface.api.facemodel.service.BaselineMeasurementService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class BaselineMeasurementController {
    private final BaselineMeasurementService measurements;

    @GetMapping("/api/v1/face-models/{modelId}/baseline-measurements")
    public ApiResponse<BaselineMeasurementResponse> read(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String modelId) {
        return ApiResponse.ok(measurements.read(principal.subject(), modelId));
    }

    @PutMapping("/internal/v1/face-models/{modelId}/baseline-measurements")
    public ApiResponse<BaselineMeasurementResponse> save(
            @PathVariable String modelId, @Valid @RequestBody BaselineMeasurementRequest request) {
        return ApiResponse.ok(measurements.save(modelId, request));
    }
}
