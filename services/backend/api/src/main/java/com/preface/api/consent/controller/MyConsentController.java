package com.preface.api.consent.controller;

import com.preface.api.consent.dto.MyConsentResponse;
import com.preface.api.consent.service.MyConsentService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users/me/consents")
@RequiredArgsConstructor
public class MyConsentController {

    private final MyConsentService myConsentService;

    /** API-AUTH-09. */
    @GetMapping
    public ApiResponse<List<MyConsentResponse>> list(
            @AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(myConsentService.myConsents(principal.subject()));
    }
}
