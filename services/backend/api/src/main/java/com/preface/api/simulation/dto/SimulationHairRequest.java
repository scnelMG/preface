package com.preface.api.simulation.dto;

import jakarta.validation.constraints.Size;

/** API-HAIR-02. {@code null}이면 해제. */
public record SimulationHairRequest(@Size(max = 36) String hairTemplateId) {}
