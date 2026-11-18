package com.preface.api.facereading.controller;

import com.preface.api.facereading.dto.FaceReadingResponse;
import com.preface.api.facereading.service.FaceReadingService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 관상(재미용, S15P31B204-438, API 가안). 3D 생성 대기 중 정면 프레임으로 부위별 풀이·조언을 만든다. 작업 1개당 1건.
 *
 * <p>요청은 바로 202로 돌려주고 풀이는 뒤에서 만든다. 화면은 조회 API를 3초마다 불러 DONE·FAILED를 기다린다.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class FaceReadingController {

    private final FaceReadingService faceReadingService;

    /** 관상 요청. 이미 있으면 그것을 돌려준다. 추출 전 READ_001, 3D 완료로 사진이 없으면 READ_002. */
    @PostMapping("/reconstructions/{jobId}/face-reading")
    public ResponseEntity<ApiResponse<FaceReadingResponse>> request(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String jobId) {
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(ApiResponse.ok(faceReadingService.request(principal.subject(), jobId)));
    }

    /** 그 작업의 관상(다시 들어왔을 때). 요청한 적이 없으면 COMMON_002. */
    @GetMapping("/reconstructions/{jobId}/face-reading")
    public ApiResponse<FaceReadingResponse> byJob(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String jobId) {
        return ApiResponse.ok(faceReadingService.getByJob(principal.subject(), jobId));
    }

    /**
     * 관상에 쓴 정면 사진(S15P31B204-452). 결과 카드에 사진을 같이 보이려고 본인에게만 JPEG로 내려 준다. 브라우저·프록시에 남지 않게 {@code
     * no-store}. 에러는 JSON(공통 응답)으로 나간다.
     */
    @GetMapping("/reconstructions/{jobId}/face-reading/photo")
    public ResponseEntity<byte[]> photo(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String jobId) {
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.noStore().cachePrivate())
                .body(faceReadingService.photo(principal.subject(), jobId));
    }

    @GetMapping("/face-readings/{readingId}")
    public ApiResponse<FaceReadingResponse> get(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String readingId) {
        return ApiResponse.ok(faceReadingService.get(principal.subject(), readingId));
    }
}
