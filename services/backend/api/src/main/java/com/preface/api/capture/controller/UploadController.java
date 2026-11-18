package com.preface.api.capture.controller;

import com.preface.api.capture.dto.MultipartCompleteRequest;
import com.preface.api.capture.dto.MultipartPartsRequest;
import com.preface.api.capture.dto.MultipartPartsResponse;
import com.preface.api.capture.dto.MultipartStartRequest;
import com.preface.api.capture.dto.MultipartStartResponse;
import com.preface.api.capture.dto.UploadPolicyResponse;
import com.preface.api.capture.dto.UploadRequest;
import com.preface.api.capture.dto.UploadResponse;
import com.preface.api.capture.service.MultipartUploadService;
import com.preface.api.capture.service.UploadService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import java.time.Duration;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 업로드 API(API-CAP-01·02). 일반 세션·업로드 전용 세션 모두 허용(SecurityConfig). */
@RestController
@RequestMapping("/api/v1/uploads")
@RequiredArgsConstructor
public class UploadController {

    private final UploadService uploadService;
    private final MultipartUploadService multipartUploadService;

    /** API-CAP-01 */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<UploadResponse> issue(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody UploadRequest request) {
        return ApiResponse.ok(uploadService.issue(principal.subject(), request));
    }

    /** multipart 시작(S15P31B204-506, 가칭 API-CAP-05). 조각 크기보다 큰 영상만. */
    @PostMapping("/multipart")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<MultipartStartResponse> startMultipart(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody MultipartStartRequest request) {
        return ApiResponse.ok(multipartUploadService.start(principal.subject(), request));
    }

    /** 조각 URL 재발급(가칭 API-CAP-06). */
    @PostMapping("/{uploadId}/parts")
    public ApiResponse<MultipartPartsResponse> presignParts(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String uploadId,
            @Valid @RequestBody MultipartPartsRequest request) {
        return ApiResponse.ok(
                multipartUploadService.presignParts(
                        principal.subject(), uploadId, request.partNumbers()));
    }

    /** multipart 완료(가칭 API-CAP-07). 그다음 REC-01은 단일 PUT과 같다. */
    @PostMapping("/{uploadId}/complete")
    public ResponseEntity<Void> completeMultipart(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String uploadId,
            @Valid @RequestBody MultipartCompleteRequest request) {
        multipartUploadService.complete(principal.subject(), uploadId, request);
        return ResponseEntity.noContent().build();
    }

    /** multipart 취소(가칭 API-CAP-08). 멱등. */
    @DeleteMapping("/{uploadId}")
    public ResponseEntity<Void> abortMultipart(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String uploadId) {
        multipartUploadService.abort(principal.subject(), uploadId);
        return ResponseEntity.noContent().build();
    }

    /** API-CAP-02 */
    @GetMapping("/policy")
    public ResponseEntity<ApiResponse<UploadPolicyResponse>> policy() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofHours(1)))
                .body(ApiResponse.ok(uploadService.policy()));
    }
}
