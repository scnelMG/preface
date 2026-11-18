package com.preface.api.simulation.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** API-EDIT-04 요청. {@code changes}는 바꾼 항목만. 항목별 기본값 복원은 {@code value=default}. */
public record MorphStateUpdateRequest(
        @NotNull Integer stateVersion, @NotEmpty List<@Valid @NotNull Change> changes) {

    public record Change(@NotBlank String code, @NotNull Double value) {}
}
