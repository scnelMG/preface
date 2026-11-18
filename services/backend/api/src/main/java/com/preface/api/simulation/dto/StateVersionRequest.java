package com.preface.api.simulation.dto;

import jakarta.validation.constraints.NotNull;

/** API-EDIT-06·07·08 요청. 낙관적 잠금용으로 클라이언트가 알고 있는 {@code stateVersion}만 보낸다. */
public record StateVersionRequest(@NotNull Integer stateVersion) {}
