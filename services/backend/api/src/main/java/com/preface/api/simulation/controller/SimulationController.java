package com.preface.api.simulation.controller;

import com.preface.api.global.security.AuthPrincipal;
import com.preface.api.simulation.dto.EditResultResponse;
import com.preface.api.simulation.dto.EyeStateUpdateRequest;
import com.preface.api.simulation.dto.MorphStateUpdateRequest;
import com.preface.api.simulation.dto.PointStrokesUpdateRequest;
import com.preface.api.simulation.dto.SimulationHairRequest;
import com.preface.api.simulation.dto.SimulationHairResponse;
import com.preface.api.simulation.dto.SimulationListResponse;
import com.preface.api.simulation.dto.SimulationResponse;
import com.preface.api.simulation.dto.SimulationTitleRequest;
import com.preface.api.simulation.dto.SimulationTitleResponse;
import com.preface.api.simulation.dto.StateVersionRequest;
import com.preface.api.simulation.service.SimulationHairService;
import com.preface.api.simulation.service.SimulationHistoryService;
import com.preface.api.simulation.service.SimulationService;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 시안 생성·조회·편집(API-EDIT-02·03·04·06·07·08)과 이력 목록·이름 바꾸기·삭제(API-HIS-05·06·07). 편집은 모두 즉시 저장된다(자동
 * 저장).
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class SimulationController {

    private final SimulationService simulationService;
    private final SimulationHistoryService historyService;
    private final SimulationHairService hairService;

    /** API-HIS-06. size는 1~50으로 맞춘다. */
    @GetMapping("/simulations")
    public ApiResponse<SimulationListResponse> list(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(required = false) String faceModelId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(historyService.list(principal.subject(), faceModelId, page, size));
    }

    /** API-HIS-05 */
    @PatchMapping("/simulations/{simulationId}")
    public ApiResponse<SimulationTitleResponse> rename(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @Valid @RequestBody SimulationTitleRequest request) {
        return ApiResponse.ok(
                historyService.rename(principal.subject(), simulationId, request.title()));
    }

    /** API-HAIR-02(2차). {@code hairTemplateId}가 null이면 해제. undo 대상 아님. */
    @PutMapping("/simulations/{simulationId}/hair")
    public ApiResponse<SimulationHairResponse> applyHair(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @Valid @RequestBody SimulationHairRequest request) {
        return ApiResponse.ok(
                hairService.apply(principal.subject(), simulationId, request.hairTemplateId()));
    }

    /** API-HIS-07. 응답 data는 빈 객체. */
    @DeleteMapping("/simulations/{simulationId}")
    public ApiResponse<Map<String, Object>> delete(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String simulationId) {
        historyService.delete(principal.subject(), simulationId);
        return ApiResponse.ok(Map.of());
    }

    /** API-EDIT-02 */
    @PostMapping("/face-models/{faceModelId}/simulations")
    public ResponseEntity<ApiResponse<SimulationResponse>> create(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String faceModelId) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(simulationService.create(principal.subject(), faceModelId)));
    }

    /** API-EDIT-03 */
    @GetMapping("/simulations/{simulationId}")
    public ApiResponse<SimulationResponse> detail(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String simulationId) {
        return ApiResponse.ok(simulationService.detail(principal.subject(), simulationId));
    }

    /** API-EDIT-04 */
    @PatchMapping("/simulations/{simulationId}/morph-state")
    public ApiResponse<EditResultResponse> updateMorphState(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @Valid @RequestBody MorphStateUpdateRequest request) {
        return ApiResponse.ok(
                simulationService.updateMorphState(
                        principal.subject(),
                        simulationId,
                        request,
                        simulationService.preparePreservedEyeState(
                                principal.subject(), simulationId, request.stateVersion()),
                        simulationService.prepareCompositeMorphState(
                                principal.subject(), simulationId, request)));
    }

    /** 눈 카드 조절을 놓았을 때 승인된 모델의 눈 상태를 저장한다. */
    @PatchMapping("/simulations/{simulationId}/eye-state")
    public ApiResponse<EditResultResponse> updateEyeState(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @Valid @RequestBody EyeStateUpdateRequest request) {
        return ApiResponse.ok(
                simulationService.updateEyeState(
                        principal.subject(),
                        simulationId,
                        request,
                        simulationService.prepareEyeState(
                                principal.subject(), simulationId, request),
                        simulationService.prepareCompositeEyeState(
                                principal.subject(), simulationId, request)));
    }

    /** 코 자유 제어점 변위. 손을 놓을 때 한 번 호출한다. */
    @PatchMapping("/simulations/{simulationId}/point-strokes")
    public ApiResponse<EditResultResponse> updatePointStrokes(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @Valid @RequestBody PointStrokesUpdateRequest request) {
        return ApiResponse.ok(
                simulationService.updatePointStrokes(
                        principal.subject(),
                        simulationId,
                        request,
                        simulationService.preparePreservedEyeState(
                                principal.subject(), simulationId, request.stateVersion())));
    }

    /** API-EDIT-06 */
    @PostMapping("/simulations/{simulationId}/undo")
    public ApiResponse<EditResultResponse> undo(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @Valid @RequestBody StateVersionRequest request) {
        return ApiResponse.ok(
                simulationService.undo(
                        principal.subject(),
                        simulationId,
                        request.stateVersion(),
                        simulationService.prepareHistoryRestore(
                                principal.subject(), simulationId, request.stateVersion(), -1),
                        simulationService.prepareCompositeHistoryRestore(
                                principal.subject(), simulationId, request.stateVersion(), -1)));
    }

    /** API-EDIT-07 */
    @PostMapping("/simulations/{simulationId}/reset")
    public ApiResponse<EditResultResponse> reset(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @Valid @RequestBody StateVersionRequest request) {
        return ApiResponse.ok(
                simulationService.reset(principal.subject(), simulationId, request.stateVersion()));
    }

    /** API-EDIT-08 */
    @PostMapping("/simulations/{simulationId}/redo")
    public ApiResponse<EditResultResponse> redo(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String simulationId,
            @Valid @RequestBody StateVersionRequest request) {
        return ApiResponse.ok(
                simulationService.redo(
                        principal.subject(),
                        simulationId,
                        request.stateVersion(),
                        simulationService.prepareHistoryRestore(
                                principal.subject(), simulationId, request.stateVersion(), 1),
                        simulationService.prepareCompositeHistoryRestore(
                                principal.subject(), simulationId, request.stateVersion(), 1)));
    }
}
