package com.preface.api.auth.dto;

import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
        @NotBlank String code, @NotBlank String state, @NotBlank String redirectUri) {}
