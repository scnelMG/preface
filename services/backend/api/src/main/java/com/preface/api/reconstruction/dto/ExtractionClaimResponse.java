package com.preface.api.reconstruction.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.Map;

/**
 * INT-EXT-01 응답 data. 계약: {@code contracts/frame-extraction/schemas/claim-response.schema.json}.
 *
 * @param attempt 추출 시도 번호. frame-urls·result 요청에 그대로 돌려준다
 * @param maxFrames 올릴 수 있는 프레임 최대 장 수(1~이 값, 고정 장 수 아님)
 * @param capture 촬영 방식·기종(S15P31B204-617)·웹 녹화 촬영 기록(S15P31B204-640). 모두 없으면 필드를 내리지 않는다
 */
public record ExtractionClaimResponse(
        String jobId,
        int attempt,
        Video input,
        int maxFrames,
        Instant claimedAt,
        long leaseTimeoutSec,
        @JsonInclude(JsonInclude.Include.NON_NULL) Capture capture) {

    /**
     * 추출 워커가 렌즈 출발값을 고르는 데 쓴다. deviceModel은 사용자가 고른 값일 수 있다. trace는 웹 녹화 촬영
     * 기록(meta·steps·trace·trackSettings)을 저장한 그대로 넘긴다(회전 부족 판정·구간 자르기·각도 기준 선택, 계획 S1-1·S1-6·S1-2).
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Capture(String method, String deviceModel, Map<String, Object> trace) {
        public static Capture of(String method, String deviceModel, Map<String, Object> trace) {
            return method == null && deviceModel == null && trace == null
                    ? null
                    : new Capture(method, deviceModel, trace);
        }
    }

    /** 원본 영상. {@code downloadUrl}은 서명 URL이라 {@link #toString()}에서 가린다. */
    public record Video(
            String downloadUrl,
            Instant expiresAt,
            String contentType,
            long sizeBytes,
            String checksumSha256) {

        @Override
        public String toString() {
            return "Video[downloadUrl=<redacted>, expiresAt=" + expiresAt + "]";
        }
    }
}
