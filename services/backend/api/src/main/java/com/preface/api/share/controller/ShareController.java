package com.preface.api.share.controller;

import com.preface.api.global.security.AuthPrincipal;
import com.preface.api.share.dto.ShareCreateRequest;
import com.preface.api.share.dto.ShareCreateResponse;
import com.preface.api.share.dto.ShareSummary;
import com.preface.api.share.service.ShareService;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 시안 공유 관리(API-SHR-01~03, 본인만). */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class ShareController {

    private final ShareService shareService;

    /** API-SHR-01. 본문({@code hairAssetId}·{@code senderName})은 둘 다 선택이다(S15P31B204-842·843). */
    @PostMapping("/simulations/{simulationId}/shares")
    public ResponseEntity<ApiResponse<ShareCreateResponse>> create(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @Valid @RequestBody(required = false) ShareCreateRequest request) {
        String hairAssetId = request == null ? null : request.hairAssetId();
        String senderName = request == null ? null : request.senderName();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(
                        ApiResponse.ok(
                                shareService.create(
                                        principal.subject(),
                                        simulationId,
                                        hairAssetId,
                                        senderName)));
    }

    /** API-SHR-02 */
    @GetMapping("/simulations/{simulationId}/shares")
    public ApiResponse<List<ShareSummary>> list(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String simulationId) {
        return ApiResponse.ok(shareService.list(principal.subject(), simulationId));
    }

    /** API-SHR-03 */
    @DeleteMapping("/shares/{shareId}")
    public ResponseEntity<Void> revoke(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String shareId) {
        shareService.revoke(principal.subject(), shareId);
        return ResponseEntity.noContent().build();
    }
}
