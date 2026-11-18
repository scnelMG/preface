package com.preface.api.simulation.controller;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.simulation.service.ExistingEyeApprovalService;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 내부 검수 작업자가 기존 모델의 누락된 눈 승인을 복구한다. */
@RestController
@RequestMapping("/internal/v1/face-models")
@RequiredArgsConstructor
public class InternalEyeApprovalController {
    private final ExistingEyeApprovalService approval;

    @PostMapping("/{modelId}/eye-approval")
    public ApiResponse<Boolean> approve(
            @PathVariable String modelId, @RequestBody EyeApprovalRequest request) {
        approval.restore(modelId, request);
        return ApiResponse.ok(true);
    }
}
