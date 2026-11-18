package com.preface.api.simulation.dto;

import java.time.Instant;

/** API-HAIR-02. {@code hairTemplateId}가 {@code null}이면 민머리(해제). */
public record SimulationHairResponse(
        String simulationId, String hairTemplateId, Instant updatedAt) {}
