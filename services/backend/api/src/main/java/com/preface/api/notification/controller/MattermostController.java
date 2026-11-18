package com.preface.api.notification.controller;

import com.preface.api.global.security.AuthPrincipal;
import com.preface.api.notification.dto.MattermostCodeRequest;
import com.preface.api.notification.dto.MattermostCodeResponse;
import com.preface.api.notification.dto.MattermostConfirmRequest;
import com.preface.api.notification.dto.MattermostLinkResponse;
import com.preface.api.notification.service.MattermostLinkService;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Mattermost 완료 알림 등록(S15P31B204-476). 등록된 아이디는 {@code GET /users/me}의 {@code mattermostUsername}으로
 * 본다.
 */
@RestController
@RequestMapping("/api/v1/users/me/mattermost")
@RequiredArgsConstructor
public class MattermostController {

    private final MattermostLinkService mattermostLinkService;

    /** 아이디로 확인 코드를 DM으로 보낸다. */
    @PostMapping("/code")
    public ApiResponse<MattermostCodeResponse> requestCode(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody MattermostCodeRequest request) {
        return ApiResponse.ok(
                mattermostLinkService.requestCode(principal.subject(), request.username()));
    }

    /** 코드가 맞으면 등록한다. */
    @PutMapping
    public ApiResponse<MattermostLinkResponse> confirm(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody MattermostConfirmRequest request) {
        return ApiResponse.ok(mattermostLinkService.confirm(principal.subject(), request.code()));
    }

    /** 알림을 끈다(등록이 없어도 204). */
    @DeleteMapping
    public ResponseEntity<Void> unlink(@AuthenticationPrincipal AuthPrincipal principal) {
        mattermostLinkService.unlink(principal.subject());
        return ResponseEntity.noContent().build();
    }
}
