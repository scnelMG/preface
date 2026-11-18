package com.preface.api.admin.controller;

import com.preface.api.admin.dto.AdminPage;
import com.preface.api.admin.dto.AdminUserListItem;
import com.preface.api.admin.service.AdminUserSearchService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 회원 목록·검색(S15P31B204-707). {@code /api/v1/admin/**} 전체가 ADMIN만 열린다(SecurityConfig).
 *
 * <p>조회 기록의 요청 경로는 {@link HttpServletRequest#getRequestURI()}(쿼리 문자열 제외)라 검색어가 남지 않는다.
 */
@RestController
@RequestMapping("/api/v1/admin/users")
@RequiredArgsConstructor
public class AdminUserController {

    private final AdminUserSearchService service;

    @GetMapping
    public ApiResponse<AdminPage<AdminUserListItem>> list(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size,
            HttpServletRequest request) {
        return ApiResponse.ok(
                service.search(principal.subject(), q, page, size, request.getRequestURI()));
    }
}
