package com.preface.api.reconstruction.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.Map;

/** 내부 검증자가 생성 모델의 코 지원 범위를 등록할 때 보내는 원본/리그 결속. */
public record NoseApprovalRequest(
        @NotBlank String schemaVersion,
        @NotNull @Valid Binding binding,
        @NotEmpty Map<@NotBlank String, @Valid @NotNull Range> ranges) {
    public record Binding(
            @NotBlank String meshSha256,
            @NotBlank String rigSha256,
            @NotBlank String fitSha,
            @NotBlank String engine,
            @NotBlank String rigVersion,
            @NotBlank String topologyVersion) {}

    public record Range(@NotNull Double min, @NotNull Double max) {}
}
