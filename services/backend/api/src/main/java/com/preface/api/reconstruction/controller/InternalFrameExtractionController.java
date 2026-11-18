package com.preface.api.reconstruction.controller;

import com.preface.api.reconstruction.dto.BundleUrlRequest;
import com.preface.api.reconstruction.dto.ClaimRequest;
import com.preface.api.reconstruction.dto.ExtractionClaimResponse;
import com.preface.api.reconstruction.dto.ExtractionResultRequest;
import com.preface.api.reconstruction.dto.ExtractionResultResponse;
import com.preface.api.reconstruction.dto.OutputUrlsResponse;
import com.preface.api.reconstruction.dto.WorkerIds;
import com.preface.api.reconstruction.service.FrameExtractionService;
import com.preface.api.reconstruction.service.WorkerPresence;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 프레임 추출 워커용 내부 API(INT-EXT-01~03, S15P31B204-353). 인증은 {@code InternalSecurityConfig}의 공유 시크릿(GPU
 * 워커와 같다). 계약: {@code contracts/frame-extraction/openapi.yaml}.
 */
@RestController
@RequestMapping("/internal/v1/frame-extraction-jobs")
@RequiredArgsConstructor
public class InternalFrameExtractionController {

    private final FrameExtractionService extractionService;
    private final WorkerPresence presence;

    /** INT-EXT-01. 작업이 없으면 204(본문 없음). */
    @PostMapping("/claim")
    public ResponseEntity<ApiResponse<ExtractionClaimResponse>> claim(
            @Valid @RequestBody ClaimRequest request) {
        presence.seen(WorkerPresence.Kind.EXTRACTOR, request.workerId());
        return extractionService
                .claim(request.workerId())
                .map(job -> ResponseEntity.ok(ApiResponse.ok(job)))
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** INT-EXT-02 */
    @PostMapping("/{jobId}/bundle-url")
    public ApiResponse<OutputUrlsResponse.Upload> bundleUrl(
            @PathVariable String jobId,
            @RequestHeader(name = WorkerIds.HEADER, required = false) String workerId,
            @Valid @RequestBody BundleUrlRequest request) {
        return ApiResponse.ok(
                extractionService.bundleUrl(jobId, requireWorkerId(workerId), request));
    }

    /** INT-EXT-03 */
    @PostMapping("/{jobId}/result")
    public ApiResponse<ExtractionResultResponse> result(
            @PathVariable String jobId,
            @RequestHeader(name = WorkerIds.HEADER, required = false) String workerId,
            @Valid @RequestBody ExtractionResultRequest request) {
        return ApiResponse.ok(
                new ExtractionResultResponse(
                        extractionService.result(jobId, requireWorkerId(workerId), request)));
    }

    /** 형식을 검사하고, 맞으면 살아 있는 워커로 기록한다(작업 중 진행 보고도 살아 있다는 신호다). */
    private String requireWorkerId(String workerId) {
        if (!WorkerIds.valid(workerId)) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST, "X-Worker-Id invalid");
        }
        presence.seen(WorkerPresence.Kind.EXTRACTOR, workerId);
        return workerId;
    }
}
