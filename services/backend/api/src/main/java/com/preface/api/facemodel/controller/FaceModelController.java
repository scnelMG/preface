package com.preface.api.facemodel.controller;

import com.preface.api.facemodel.dto.FaceModelDeleteResponse;
import com.preface.api.facemodel.dto.FaceModelDetailResponse;
import com.preface.api.facemodel.dto.FaceModelListResponse;
import com.preface.api.facemodel.dto.FaceModelTitleRequest;
import com.preface.api.facemodel.dto.FaceModelTitleResponse;
import com.preface.api.facemodel.dto.FrontPhotoResponse;
import com.preface.api.facemodel.dto.ThumbnailSaveRequest;
import com.preface.api.facemodel.dto.ThumbnailSaveResponse;
import com.preface.api.facemodel.dto.ThumbnailUploadRequest;
import com.preface.api.facemodel.dto.ThumbnailUploadResponse;
import com.preface.api.facemodel.service.FaceModelService;
import com.preface.api.facemodel.service.FrontPhotoService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import jakarta.validation.Valid;
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
 * 내 머리(3D) 목록·상세·이름 바꾸기·삭제(API-HIS-01·02·03). 시안 생성(API-EDIT-02)은 {@code SimulationController}에 있다.
 */
@RestController
@RequestMapping("/api/v1/face-models")
@RequiredArgsConstructor
public class FaceModelController {

    private final FaceModelService faceModelService;
    private final FrontPhotoService frontPhotoService;

    /** API-HIS-01. size는 1~50으로 맞춘다. */
    @GetMapping
    public ApiResponse<FaceModelListResponse> list(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(faceModelService.list(principal.subject(), page, size));
    }

    /** API-HIS-02 */
    @GetMapping("/{faceModelId}")
    public ApiResponse<FaceModelDetailResponse> detail(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String faceModelId) {
        return ApiResponse.ok(faceModelService.detail(principal.subject(), faceModelId));
    }

    /** 내 3D의 정면 사진 presigned GET(10분, S15P31B204-604). 남의 것·삭제된 것·사진 없는 예전 3D는 COMMON_002. */
    @GetMapping("/{faceModelId}/front-photo")
    public ApiResponse<FrontPhotoResponse> frontPhoto(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String faceModelId) {
        return ApiResponse.ok(frontPhotoService.frontPhoto(principal.subject(), faceModelId));
    }

    /** 내 머리 이름 바꾸기(S15P31B204-399). 남의 것·삭제된 것은 COMMON_002, 1~20자가 아니면 COMMON_001. */
    @PatchMapping("/{faceModelId}")
    public ApiResponse<FaceModelTitleResponse> rename(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String faceModelId,
            @Valid @RequestBody FaceModelTitleRequest request) {
        return ApiResponse.ok(
                faceModelService.rename(principal.subject(), faceModelId, request.title()));
    }

    /** 내 머리 썸네일 업로드 URL(S15P31B204-436, 가안). 이미 있으면 HIS_010. */
    @PostMapping("/{faceModelId}/thumbnail-upload-url")
    public ApiResponse<ThumbnailUploadResponse> thumbnailUploadUrl(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String faceModelId,
            @Valid @RequestBody ThumbnailUploadRequest request) {
        return ApiResponse.ok(
                faceModelService.thumbnailUploadUrl(principal.subject(), faceModelId, request));
    }

    /** 올린 썸네일 저장(S15P31B204-436, 가안). 올라오지 않았으면 HIS_011, 이미 있으면 그대로 둔다. */
    @PutMapping("/{faceModelId}/thumbnail")
    public ApiResponse<ThumbnailSaveResponse> saveThumbnail(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String faceModelId,
            @Valid @RequestBody ThumbnailSaveRequest request) {
        return ApiResponse.ok(
                faceModelService.saveThumbnail(principal.subject(), faceModelId, request));
    }

    /** API-HIS-03. 물리 삭제는 30일 뒤 배치라 202. */
    @DeleteMapping("/{faceModelId}")
    public ResponseEntity<ApiResponse<FaceModelDeleteResponse>> delete(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String faceModelId) {
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(ApiResponse.ok(faceModelService.delete(principal.subject(), faceModelId)));
    }
}
