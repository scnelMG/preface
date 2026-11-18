package com.preface.api.consult.controller;

import com.preface.api.consult.dto.ApplyChangeRequestRequest;
import com.preface.api.consult.dto.ApplyChangeRequestResponse;
import com.preface.api.consult.dto.ConsultMessageListResponse;
import com.preface.api.consult.dto.SendMessageRequest;
import com.preface.api.consult.dto.SendMessageResponse;
import com.preface.api.consult.service.ConsultService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 상담 메시지(API-CON-01·02)와 변경 요청 반영(API-EDIT-05). */
@RestController
@RequestMapping("/api/v1/simulations/{simulationId}")
@RequiredArgsConstructor
public class ConsultController {

    private static final Logger log = LoggerFactory.getLogger(ConsultController.class);
    private final ConsultService consultService;

    /** API-CON-01 */
    @PostMapping("/messages")
    public ApiResponse<SendMessageResponse> send(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @RequestBody SendMessageRequest request) {
        long started = System.nanoTime();
        try {
            return ApiResponse.ok(consultService.send(principal.subject(), simulationId, request));
        } finally {
            log.info("consult_stage operation=send stage=total durationMs={}", elapsedMs(started));
        }
    }

    /** API-CON-02. size는 1~50으로 맞춘다. */
    @GetMapping("/messages")
    public ApiResponse<ConsultMessageListResponse> messages(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "false") boolean archived) {
        return ApiResponse.ok(
                consultService.messages(principal.subject(), simulationId, page, size, archived));
    }

    @PostMapping("/messages/new-conversation")
    public ApiResponse<Map<String, Integer>> newConversation(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String simulationId) {
        return ApiResponse.ok(
                Map.of(
                        "conversationAfterSeq",
                        consultService.newConversation(principal.subject(), simulationId)));
    }

    /** API-EDIT-05 */
    @PostMapping("/change-requests/{requestId}/apply")
    public ApiResponse<ApplyChangeRequestResponse> apply(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @PathVariable String requestId,
            @Valid @RequestBody ApplyChangeRequestRequest request) {
        long started = System.nanoTime();
        try {
            return ApiResponse.ok(
                    consultService.apply(
                            principal.subject(), simulationId, requestId, request.stateVersion()));
        } finally {
            log.info("consult_stage operation=apply stage=total durationMs={}", elapsedMs(started));
        }
    }

    private static long elapsedMs(long started) {
        return (System.nanoTime() - started) / 1_000_000;
    }

    @PostMapping("/change-requests/{requestId}/preview")
    public ApiResponse<ApplyChangeRequestResponse> preview(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @PathVariable String requestId,
            @Valid @RequestBody ApplyChangeRequestRequest request) {
        return ApiResponse.ok(
                consultService.preview(
                        principal.subject(), simulationId, requestId, request.stateVersion()));
    }
}
