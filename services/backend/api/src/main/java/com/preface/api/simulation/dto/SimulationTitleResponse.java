package com.preface.api.simulation.dto;

import java.time.Instant;

/** API-HIS-05. */
public record SimulationTitleResponse(String simulationId, String title, Instant updatedAt) {}
