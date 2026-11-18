package com.preface.api.simulation.controller;

import com.preface.api.simulation.dto.MorphParametersResponse;
import com.preface.api.simulation.service.MorphParameterService;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/morph-parameters")
@RequiredArgsConstructor
public class MorphParameterController {

    private final MorphParameterService morphParameterService;

    /** API-EDIT-01. 인증 선택(비로그인 체험 실험실도 부른다). */
    @GetMapping
    public ApiResponse<MorphParametersResponse> list(
            @RequestParam(defaultValue = "v1") String schemaVersion) {
        return ApiResponse.ok(morphParameterService.list(schemaVersion));
    }
}
