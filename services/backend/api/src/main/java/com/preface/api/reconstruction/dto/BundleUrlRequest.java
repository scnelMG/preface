package com.preface.api.reconstruction.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * INT-EXT-02 요청. 계약: {@code contracts/frame-extraction/schemas/bundle-url-request.schema.json}.
 *
 * <p>크기·체크섬을 서명에 넣으므로 묶음을 다 만든 뒤에 요청한다.
 */
public record BundleUrlRequest(
        @Min(1) int attempt,
        @Min(1) long sizeBytes,
        @NotNull @Pattern(regexp = "^[A-Za-z0-9+/]{43}=$") String checksumSha256) {}
