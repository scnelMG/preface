package com.preface.api.admin.controller;

import com.preface.api.admin.dto.AdminFaceModelAssetsResponse;
import com.preface.api.admin.dto.AdminFaceModelListResponse;
import com.preface.api.admin.dto.AdminStorageResponse;
import com.preface.api.admin.service.AdminUserDataService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자: 회원별 3D 목록·3D 파일·S3 보관 목록(S15P31B204-653). {@code /api/v1/admin/**} 전체가 ADMIN만
 * 열린다(SecurityConfig). 모든 응답은 조회 기록을 남긴다.
 */
@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
public class AdminUserDataController {

    private final AdminUserDataService service;

    @GetMapping("/users/{userId}/face-models")
    public ApiResponse<AdminFaceModelListResponse> faceModels(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String userId,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size,
            HttpServletRequest request) {
        return ApiResponse.ok(
                service.faceModels(
                        principal.subject(), userId, page, size, request.getRequestURI()));
    }

    /** 서명 URL(5분)을 담으므로 캐시하지 않는다. */
    @GetMapping("/face-models/{faceModelId}/assets")
    public ResponseEntity<ApiResponse<AdminFaceModelAssetsResponse>> assets(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String faceModelId,
            HttpServletRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(
                        ApiResponse.ok(
                                service.assets(
                                        principal.subject(),
                                        faceModelId,
                                        request.getRequestURI())));
    }

    @GetMapping("/users/{userId}/storage")
    public ApiResponse<AdminStorageResponse> storage(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String userId,
            HttpServletRequest request) {
        return ApiResponse.ok(
                service.storage(principal.subject(), userId, request.getRequestURI()));
    }
}
