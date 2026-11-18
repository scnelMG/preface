package com.preface.api.capture.controller;

import com.preface.api.capture.dto.CaptureExchangeRequest;
import com.preface.api.capture.dto.CaptureExchangeResponse;
import com.preface.api.capture.dto.CaptureLinkResponse;
import com.preface.api.capture.dto.CaptureLinkStatusResponse;
import com.preface.api.capture.service.CaptureLinkService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** QR 휴대폰 연결 API(API-QR-01~04). 허용 세션 종류는 SecurityConfig가 정한다. */
@RestController
@RequestMapping("/api/v1/capture-links")
@RequiredArgsConstructor
public class CaptureLinkController {

    private final CaptureLinkService captureLinkService;

    /** API-QR-01 (일반 세션) */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<CaptureLinkResponse> create(
            @AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(captureLinkService.create(principal.subject()));
    }

    /** API-QR-02 (인증 없음) */
    @PostMapping("/exchange")
    public ApiResponse<CaptureExchangeResponse> exchange(
            @Valid @RequestBody CaptureExchangeRequest request) {
        return ApiResponse.ok(captureLinkService.exchange(request.token()));
    }

    /** API-QR-03 (일반 세션, PC 폴링) */
    @GetMapping("/{linkId}")
    public ApiResponse<CaptureLinkStatusResponse> status(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String linkId) {
        return ApiResponse.ok(captureLinkService.status(principal.subject(), linkId));
    }

    /** API-QR-04 (일반 세션 또는 그 링크의 업로드 전용 세션) */
    @DeleteMapping("/{linkId}")
    public ApiResponse<Map<String, Object>> cancel(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String linkId) {
        return ApiResponse.ok(captureLinkService.cancel(principal, linkId));
    }
}
