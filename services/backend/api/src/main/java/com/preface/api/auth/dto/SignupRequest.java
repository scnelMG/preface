package com.preface.api.auth.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record SignupRequest(@NotNull List<@Valid @NotNull ConsentAgreement> consents) {

    public record ConsentAgreement(@NotBlank String consentDocumentId, @NotNull Boolean agreed) {}
}
