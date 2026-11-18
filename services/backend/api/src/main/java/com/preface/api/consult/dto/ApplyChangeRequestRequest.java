package com.preface.api.consult.dto;

import jakarta.validation.constraints.NotNull;

/** API-EDIT-05 요청. 낙관적 잠금용 {@code stateVersion}만 보낸다. */
public record ApplyChangeRequestRequest(@NotNull Integer stateVersion) {}
