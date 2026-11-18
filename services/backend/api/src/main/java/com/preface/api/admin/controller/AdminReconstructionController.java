package com.preface.api.admin.controller;

import com.preface.api.admin.dto.AdminJobDetailResponse;
import com.preface.api.admin.dto.AdminJobListItem;
import com.preface.api.admin.dto.AdminJobQueueResponse;
import com.preface.api.admin.dto.AdminJobSummaryResponse;
import com.preface.api.admin.dto.AdminPage;
import com.preface.api.admin.service.AdminJobService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 복원 작업 화면(S15P31B204-652). {@code /api/v1/admin/**} 전체가 ADMIN만 열린다(SecurityConfig).
 *
 * <p>조회 기록의 요청 경로는 {@link HttpServletRequest#getRequestURI()}(쿼리 문자열 제외)다.
 */
@RestController
@RequestMapping("/api/v1/admin/reconstructions")
@RequiredArgsConstructor
public class AdminReconstructionController {

    private final AdminJobService adminJobService;

    @GetMapping("/summary")
    public ApiResponse<AdminJobSummaryResponse> summary(
            @RequestParam(defaultValue = "today") String period) {
        return ApiResponse.ok(adminJobService.summary(period));
    }

    @GetMapping
    public ApiResponse<AdminPage<AdminJobListItem>> list(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String failCode,
            @RequestParam(required = false) String stage,
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size,
            HttpServletRequest request) {
        return ApiResponse.ok(
                adminJobService.list(
                        principal.subject(),
                        new AdminJobService.ListQuery(
                                status, failCode, stage, userId, from, to, page, size),
                        request.getRequestURI()));
    }

    @GetMapping("/queue")
    public ApiResponse<AdminJobQueueResponse> queue() {
        return ApiResponse.ok(adminJobService.queue());
    }

    @GetMapping("/{jobId}")
    public ApiResponse<AdminJobDetailResponse> detail(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String jobId,
            HttpServletRequest request) {
        return ApiResponse.ok(
                adminJobService.detail(principal.subject(), jobId, request.getRequestURI()));
    }
}
