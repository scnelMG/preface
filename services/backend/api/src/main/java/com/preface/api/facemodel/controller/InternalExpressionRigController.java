package com.preface.api.facemodel.controller;

import com.preface.api.facemodel.dto.ExpressionRigRequest;
import com.preface.api.facemodel.service.ExistingExpressionRigService;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 내부 시크릿이 있는 작업자만 호출한다. 공개 사용자 API가 아니다. 기존 모델에 표정 트래킹 리그를 보충한다(S15P31B204-879). */
@RestController
@RequestMapping("/internal/v1/face-models")
@RequiredArgsConstructor
public class InternalExpressionRigController {

    private final ExistingExpressionRigService expressionRigs;

    @PostMapping("/{faceModelId}/expression-rig")
    public ApiResponse<Boolean> attach(
            @PathVariable String faceModelId, @Valid @RequestBody ExpressionRigRequest request) {
        expressionRigs.attach(faceModelId, request);
        return ApiResponse.ok(true);
    }
}
