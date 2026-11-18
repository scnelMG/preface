package com.preface.api.reconstruction.dto;

import java.time.Instant;
import java.util.Map;

/**
 * INT-REC-04 응답 data. 계약: {@code
 * contracts/reconstruction/schemas/output-urls-response.schema.json}.
 *
 * @param expression 표정 트래킹 리그 업로드 URL(S15P31B204-879). 워커는 이 항목이 있을 때만 표정 리그를 만들어 올린다
 * @param captures 5방향 얼굴 사진 업로드 URL. 키는 {@code CaptureAngle} 이름(FRONT·LEFT·RIGHT·LEFT_45·RIGHT_45)
 */
public record OutputUrlsResponse(
        Upload mesh,
        Upload rig,
        Upload expression,
        Upload texture,
        Upload thumbnail,
        Map<String, Upload> captures) {

    /** uploadUrl은 서명 URL이라 {@link #toString()}에서 가린다. */
    public record Upload(
            String objectKey,
            String uploadUrl,
            String method,
            Map<String, String> headers,
            Instant expiresAt) {

        @Override
        public String toString() {
            return "Upload[objectKey=" + objectKey + ", uploadUrl=<redacted>]";
        }
    }
}
