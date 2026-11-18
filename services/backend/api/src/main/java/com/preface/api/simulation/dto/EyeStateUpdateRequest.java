package com.preface.api.simulation.dto;

import jakarta.validation.constraints.NotNull;

/** 눈 조절을 놓았을 때 전체 눈 상태를 한 번 저장한다. */
public record EyeStateUpdateRequest(@NotNull Integer stateVersion, @NotNull EyeEditState eyeEdit) {}
