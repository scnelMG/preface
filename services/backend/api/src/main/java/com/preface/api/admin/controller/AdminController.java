package com.preface.api.admin.controller;

import com.preface.api.admin.dto.AdminMeResponse;
import com.preface.api.admin.service.AdminQueryService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 관리자 API. {@code /api/v1/admin/**} 전체가 ADMIN만 열린다(SecurityConfig). */
@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
public class AdminController {

    private final AdminQueryService adminQueryService;

    /** 관리자 본인 확인. FE가 관리자 화면에 들어올 때 부르고, 403이면 화면을 막는다. */
    @GetMapping("/me")
    public ApiResponse<AdminMeResponse> me(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(adminQueryService.me(principal.subject()));
    }
}
