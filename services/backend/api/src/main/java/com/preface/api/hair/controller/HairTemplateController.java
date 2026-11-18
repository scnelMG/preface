package com.preface.api.hair.controller;

import com.preface.api.hair.dto.HairTemplateListResponse;
import com.preface.api.hair.service.HairTemplateService;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 헤어 템플릿 목록(API-HAIR-01, 2차). 적용·해제(API-HAIR-02)는 {@code SimulationController}에 있다. */
@RestController
@RequestMapping("/api/v1/hair-templates")
@RequiredArgsConstructor
public class HairTemplateController {

    private final HairTemplateService hairTemplateService;

    /** 로그인 사용자 공용 목록. 노출(active) 템플릿만 sort_order 순. */
    @GetMapping
    public ApiResponse<HairTemplateListResponse> list() {
        return ApiResponse.ok(hairTemplateService.list());
    }
}
