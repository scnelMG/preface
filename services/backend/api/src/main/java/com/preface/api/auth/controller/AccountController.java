package com.preface.api.auth.controller;

import com.preface.api.auth.dto.WithdrawalResponse;
import com.preface.api.auth.service.WithdrawalService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 회원 탈퇴(API-AUTH-11). 경로는 {@code /users/me}지만 auth에 둔다: 세션 폐기(refresh 저장소·쿠키)가 auth 안에 있고, auth가 이미
 * user를 의존해서 {@code UserController}(user)에 두면 user → auth 순환이 생긴다.
 */
@RestController
@RequestMapping("/api/v1/users/me")
@RequiredArgsConstructor
public class AccountController {

    private final WithdrawalService withdrawalService;
    private final RefreshCookies refreshCookies;

    /** API-AUTH-11. 202 + refresh 쿠키 만료. */
    @DeleteMapping
    public ResponseEntity<ApiResponse<WithdrawalResponse>> withdraw(
            @AuthenticationPrincipal AuthPrincipal principal) {
        withdrawalService.withdraw(principal.subject());
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .header(HttpHeaders.SET_COOKIE, refreshCookies.expire().toString())
                .body(ApiResponse.ok(new WithdrawalResponse(WithdrawalResponse.PENDING)));
    }
}
