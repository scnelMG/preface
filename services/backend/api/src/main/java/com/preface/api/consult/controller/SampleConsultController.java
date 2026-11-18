package com.preface.api.consult.controller;

import com.preface.api.consult.dto.SampleConsultRequest;
import com.preface.api.consult.service.AiConsult;
import com.preface.api.consult.service.SampleConsultService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 로그인 회원의 남녀 기본 모델 체험 상담. */
@RestController
@RequestMapping("/api/v1/sample-models")
@RequiredArgsConstructor
public class SampleConsultController {
    private final SampleConsultService service;

    @PostMapping("/{sampleKey}/consult")
    public ApiResponse<AiConsult.Response> consult(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String sampleKey,
            @RequestBody SampleConsultRequest request) {
        return ApiResponse.ok(service.consult(principal.subject(), sampleKey, request));
    }
}
