package com.preface.api.reconstruction.controller;

import com.preface.api.global.security.AuthPrincipal;
import com.preface.api.global.security.TokenScope;
import com.preface.api.reconstruction.dto.CreateReconstructionRequest;
import com.preface.api.reconstruction.dto.CreateReconstructionResponse;
import com.preface.api.reconstruction.dto.CreatedReconstruction;
import com.preface.api.reconstruction.dto.ReconstructionStatusResponse;
import com.preface.api.reconstruction.service.ReconstructionService;
import com.preface.api.reconstruction.service.Requester;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 3D 복원 API(API-REC-01~03).
 *
 * <p>REC-01·02는 업로드 전용 세션({@code scope=capture}, 휴대폰)도 부른다(SecurityConfig 매처). 그때는 {@link
 * Requester#capture}로 넘겨 그 QR 링크 범위로 제한한다.
 */
@RestController
@RequestMapping("/api/v1/reconstructions")
@RequiredArgsConstructor
public class ReconstructionController {

    private final ReconstructionService reconstructionService;

    /** API-REC-01. 새로 만들면 202, 같은 uploadId 재호출이면 200. */
    @PostMapping
    public ResponseEntity<ApiResponse<CreateReconstructionResponse>> create(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody CreateReconstructionRequest request) {
        CreatedReconstruction result =
                reconstructionService.create(requester(principal), request.uploadId());
        return ResponseEntity.status(result.created() ? HttpStatus.ACCEPTED : HttpStatus.OK)
                .body(ApiResponse.ok(result.body()));
    }

    /** API-REC-03. 경로 매칭에서 {@code /{jobId}}보다 먼저 잡힌다(고정 경로 우선). */
    @GetMapping("/current")
    public ApiResponse<ReconstructionStatusResponse> current(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "false") boolean includeRecentFailed) {
        return ApiResponse.ok(
                reconstructionService.current(principal.subject(), includeRecentFailed));
    }

    /** API-REC-02 */
    @GetMapping("/{jobId}")
    public ApiResponse<ReconstructionStatusResponse> get(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String jobId) {
        return ApiResponse.ok(reconstructionService.get(requester(principal), jobId));
    }

    private static Requester requester(AuthPrincipal principal) {
        return principal.scope() == TokenScope.CAPTURE
                ? Requester.capture(principal.subject(), principal.captureLinkId())
                : Requester.user(principal.subject());
    }
}
