package com.preface.api.reconstruction.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

/**
 * INT-EXT-03 요청. 계약: {@code contracts/frame-extraction/schemas/result-request.schema.json}.
 *
 * <p>성공·실패 필드를 한 record에 두고, status별 필수 값은 서비스가 검사한다.
 *
 * @param bundle SUCCEEDED면 필수. INT-EXT-02로 올린 묶음
 * @param lens 영상에서 읽은 렌즈 정보. 서버는 해석하지 않고 GPU claim에 그대로 넘긴다(키 이름은 AI 파트가 정한다)
 * @param videoMeta INT-REC-03과 같은 형식. 위치(GPS)는 받지 않는다
 */
public record ExtractionResultRequest(
        @Min(1) int attempt,
        @NotNull @Pattern(regexp = "SUCCEEDED|FAILED") String status,
        @Valid Bundle bundle,
        Map<String, Object> lens,
        @Valid ResultRequest.VideoMeta videoMeta,
        @Size(max = 10) List<String> failCodes,
        String debugMessage) {

    public boolean succeeded() {
        return "SUCCEEDED".equals(status);
    }

    /**
     * @param frameCount 묶음 안 프레임 장 수(1~maxFrames, 고정 아님)
     */
    public record Bundle(
            @NotNull @Size(max = 500) String objectKey,
            @Min(1) long sizeBytes,
            @NotNull @Pattern(regexp = "^[A-Za-z0-9+/]{43}=$") String checksumSha256,
            @Min(1) int frameCount) {}
}
