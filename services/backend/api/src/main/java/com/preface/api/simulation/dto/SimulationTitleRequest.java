package com.preface.api.simulation.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** API-HIS-05. 이름 1~100자. 앞뒤 공백은 서버가 지운다(공백만이면 COMMON_001). */
public record SimulationTitleRequest(@NotBlank @Size(max = 100) String title) {}
