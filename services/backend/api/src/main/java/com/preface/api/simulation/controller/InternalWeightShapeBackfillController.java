package com.preface.api.simulation.controller;

import com.preface.api.simulation.dto.WeightShapeBackfillRequest;
import com.preface.api.simulation.service.WeightShapeBackfillService;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 공유 시크릿으로 보호되는 기존 생성 모델 활성화 엔드포인트. */
@RestController
@RequestMapping("/internal/v1/weight-shape-backfills")
@RequiredArgsConstructor
public class InternalWeightShapeBackfillController {
    private final WeightShapeBackfillService service;

    @PostMapping("/{modelId}/activate")
    public ApiResponse<Boolean> activate(
            @PathVariable String modelId, @Valid @RequestBody WeightShapeBackfillRequest request) {
        service.activate(modelId, request);
        return ApiResponse.ok(true);
    }

    @PostMapping("/{modelId}/cheekbone-repair")
    public ApiResponse<Boolean> repairCheekbone(
            @PathVariable String modelId, @Valid @RequestBody WeightShapeBackfillRequest request) {
        service.activateCheekboneRepair(modelId, request);
        return ApiResponse.ok(true);
    }

    @PostMapping("/{modelId}/contour-recovery")
    public ApiResponse<Boolean> recoverContour(
            @PathVariable String modelId, @Valid @RequestBody WeightShapeBackfillRequest request) {
        service.activateContourRecovery(modelId, request);
        return ApiResponse.ok(true);
    }
}
