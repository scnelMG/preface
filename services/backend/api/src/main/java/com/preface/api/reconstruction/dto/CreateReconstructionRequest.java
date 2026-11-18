package com.preface.api.reconstruction.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** API-REC-01 요청. */
public record CreateReconstructionRequest(@NotBlank @Size(max = 36) String uploadId) {}
