package com.preface.api.user.controller;

import com.preface.api.global.security.AuthPrincipal;
import com.preface.api.user.dto.MeResponse;
import com.preface.api.user.service.UserQueryService;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {

    private final UserQueryService userQueryService;

    /** API-AUTH-05. */
    @GetMapping("/me")
    public ApiResponse<MeResponse> me(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(userQueryService.me(principal.subject()));
    }
}
