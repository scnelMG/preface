package com.preface.api.simulation.controller;

import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.api.simulation.dto.NoseCapabilities;
import com.preface.api.simulation.service.ExistingNoseRigService;
import com.preface.api.simulation.service.NoseEditService;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 내부 시크릿이 있는 3D 승인 작업자만 호출한다. 공개 사용자 API가 아니다. */
@RestController
@RequestMapping("/internal/v1/face-models")
@RequiredArgsConstructor
public class InternalNoseApprovalController {

    private final NoseEditService noseEditService;
    private final ExistingNoseRigService existingNoseRigService;

    @PostMapping("/{modelId}/nose-rig-upgrade")
    public ApiResponse<Boolean> upgrade(
            @PathVariable String modelId, @Valid @RequestBody NoseApprovalRequest request) {
        existingNoseRigService.upgrade(modelId, request);
        return ApiResponse.ok(true);
    }

    @PostMapping("/{modelId}/nose-approval")
    public ApiResponse<NoseCapabilities> approve(
            @PathVariable String modelId, @Valid @RequestBody NoseApprovalRequest request) {
        return ApiResponse.ok(noseEditService.approve(modelId, request));
    }

    @DeleteMapping("/{modelId}/nose-approval")
    public ApiResponse<Map<String, Object>> revoke(@PathVariable String modelId) {
        noseEditService.revoke(modelId);
        return ApiResponse.ok(Map.of());
    }
}
