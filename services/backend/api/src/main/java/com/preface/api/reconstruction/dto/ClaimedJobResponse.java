package com.preface.api.reconstruction.dto;

import java.time.Instant;
import java.util.Map;

/**
 * INT-REC-01 응답 data. 계약: {@code contracts/reconstruction/schemas/claim-response.schema.json}.
 *
 * <p>입력은 원본 영상이 아니라 추출 워커가 만든 프레임 묶음이다(S15P31B204-353). {@code input.downloadUrl}은 서명 URL이다. 로그에
 * 남기지 않는다({@link Input#toString()}에서 가린다).
 */
public record ClaimedJobResponse(
        String jobId,
        Input input,
        String outputPrefix,
        String morphSchemaVersion,
        Instant claimedAt,
        long heartbeatIntervalSec,
        long leaseTimeoutSec) {

    /**
     * @param frameCount 묶음 안 프레임 장 수(최대 maxFrames, 고정 아님)
     * @param lens 추출 워커가 영상에서 읽은 렌즈 정보(묶음 안 메타 파일과 같은 값). 없으면 null
     */
    public record Input(
            String downloadUrl,
            Instant expiresAt,
            String contentType,
            long sizeBytes,
            String checksumSha256,
            int frameCount,
            Map<String, Object> lens) {

        @Override
        public String toString() {
            return "Input[downloadUrl=<redacted>, expiresAt=" + expiresAt + "]";
        }
    }
}
