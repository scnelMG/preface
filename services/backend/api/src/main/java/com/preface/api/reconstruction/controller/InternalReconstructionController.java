package com.preface.api.reconstruction.controller;

import com.preface.api.reconstruction.dto.ClaimRequest;
import com.preface.api.reconstruction.dto.ClaimedJobResponse;
import com.preface.api.reconstruction.dto.OutputUrlsResponse;
import com.preface.api.reconstruction.dto.ProgressRequest;
import com.preface.api.reconstruction.dto.ProgressResponse;
import com.preface.api.reconstruction.dto.ResultRequest;
import com.preface.api.reconstruction.dto.ResultResponse;
import com.preface.api.reconstruction.dto.WorkerIds;
import com.preface.api.reconstruction.service.ReconstructionWorkerService;
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
 * GPU 워커용 내부 API(INT-REC-01~04). 인증은 {@code InternalSecurityConfig}의 공유 시크릿. 계약: {@code
 * contracts/reconstruction/openapi.yaml}.
 */
@RestController
@RequestMapping("/internal/v1")
@RequiredArgsConstructor
public class InternalReconstructionController {

    private final ReconstructionWorkerService workerService;
    private final WorkerPresence presence;

    /** INT-REC-01. 작업이 없으면 204(본문 없음). */
    @PostMapping("/reconstruction-jobs/claim")
    public ResponseEntity<ApiResponse<ClaimedJobResponse>> claim(
            @Valid @RequestBody ClaimRequest request) {
        presence.seen(WorkerPresence.Kind.GPU, request.workerId());
        return workerService
                .claim(request.workerId())
                .map(job -> ResponseEntity.ok(ApiResponse.ok(job)))
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** INT-REC-02 */
    @PostMapping("/reconstructions/{jobId}/progress")
    public ApiResponse<ProgressResponse> progress(
            @PathVariable String jobId,
            @RequestHeader(name = WorkerIds.HEADER, required = false) String workerId,
            @Valid @RequestBody ProgressRequest request) {
        return ApiResponse.ok(
                new ProgressResponse(
                        workerService.progress(jobId, requireWorkerId(workerId), request)));
    }

    /** INT-REC-04 */
    @PostMapping("/reconstructions/{jobId}/output-urls")
    public ApiResponse<OutputUrlsResponse> outputUrls(
            @PathVariable String jobId,
            @RequestHeader(name = WorkerIds.HEADER, required = false) String workerId) {
        return ApiResponse.ok(workerService.outputUrls(jobId, requireWorkerId(workerId)));
    }

    /** INT-REC-03 */
    @PostMapping("/reconstructions/{jobId}/result")
    public ApiResponse<ResultResponse> result(
            @PathVariable String jobId,
            @RequestHeader(name = WorkerIds.HEADER, required = false) String workerId,
            @Valid @RequestBody ResultRequest request) {
        return ApiResponse.ok(
                new ResultResponse(
                        workerService.result(jobId, requireWorkerId(workerId), request)));
    }

    /** 형식을 검사하고, 맞으면 살아 있는 워커로 기록한다(작업 중 진행 보고도 살아 있다는 신호다). */
    private String requireWorkerId(String workerId) {
        if (!WorkerIds.valid(workerId)) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST, "X-Worker-Id invalid");
        }
        presence.seen(WorkerPresence.Kind.GPU, workerId);
        return workerId;
    }
}
