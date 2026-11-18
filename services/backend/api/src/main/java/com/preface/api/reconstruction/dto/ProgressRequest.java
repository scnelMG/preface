package com.preface.api.reconstruction.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** INT-REC-02 요청. 계약: {@code contracts/reconstruction/schemas/progress-request.schema.json}. */
public record ProgressRequest(
        @NotNull @Pattern(regexp = "RUNNING") String status,
        @NotNull @Pattern(regexp = "FRAME_SELECT|QUALITY_CHECK|RECONSTRUCT|FINALIZE") String stage,
        @Pattern(regexp = "^[A-Z0-9_]{1,30}$") String engine) {}
