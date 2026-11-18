package com.preface.api.comparison.controller;

import com.preface.api.comparison.dto.FirstComparisonResponse;
import com.preface.api.comparison.service.FirstComparisonService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class FirstComparisonController {
    private final FirstComparisonService comparison;

    @PostMapping("/api/v1/simulations/{simulationId}/first-comparison")
    public ApiResponse<FirstComparisonResponse> preview(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String simulationId) {
        return ApiResponse.ok(comparison.preview(principal.subject(), simulationId));
    }
}
