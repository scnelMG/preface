package com.preface.api.reconstruction.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** INT-REC-01 요청. 계약: {@code contracts/reconstruction/schemas/claim-request.schema.json}. */
public record ClaimRequest(@NotNull @Pattern(regexp = WorkerIds.PATTERN) String workerId) {}
