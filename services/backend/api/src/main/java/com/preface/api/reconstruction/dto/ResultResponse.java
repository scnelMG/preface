package com.preface.api.reconstruction.dto;

/** INT-REC-03 응답. FAILED면 faceModelId는 null. */
public record ResultResponse(String faceModelId) {}
