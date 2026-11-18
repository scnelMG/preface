package com.preface.api.share.controller;

import com.preface.api.share.dto.ShareViewResponse;
import com.preface.api.share.service.ShareService;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 공유 보기(API-SHR-04). 로그인 없이 연다(SecurityConfig의 {@code GET /api/v1/shares/*}). 얼굴 데이터라 캐시·검색 색인을
 * 막는다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PublicShareController {

    private final ShareService shareService;

    @GetMapping("/shares/{token}")
    public ResponseEntity<ApiResponse<ShareViewResponse>> view(@PathVariable String token) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header("X-Robots-Tag", "noindex")
                .body(ApiResponse.ok(shareService.view(token)));
    }
}
