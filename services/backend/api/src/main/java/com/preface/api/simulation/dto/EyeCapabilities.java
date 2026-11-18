package com.preface.api.simulation.dto;

import java.util.Map;

/** 3D-308이 같은 메시·리그에 대해 검증한 눈 조절 한계(엔진 단위 0~100). */
public record EyeCapabilities(
        String schemaVersion,
        String meshSha256,
        String rigSha256,
        String eyePartsSha256,
        String engine,
        String rigVersion,
        String topologyVersion,
        Map<String, Double> limits) {}
