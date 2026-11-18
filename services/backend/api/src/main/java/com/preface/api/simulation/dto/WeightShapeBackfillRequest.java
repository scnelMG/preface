package com.preface.api.simulation.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** 비공개 개발 배치가 생성한 기존·신규 GLB의 결속. */
public record WeightShapeBackfillRequest(
        @NotBlank String oldKey,
        @NotBlank String newKey,
        @NotBlank @Pattern(regexp = "[a-f0-9]{64}") String oldSha256,
        @NotBlank @Pattern(regexp = "[a-f0-9]{64}") String newSha256) {}
