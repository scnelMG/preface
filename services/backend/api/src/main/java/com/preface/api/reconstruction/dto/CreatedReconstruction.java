package com.preface.api.reconstruction.dto;

/**
 * API-REC-01 처리 결과.
 *
 * @param created 새로 만들었으면 true(202), 같은 uploadId 재호출이라 기존 작업을 돌려주면 false(200)
 */
public record CreatedReconstruction(CreateReconstructionResponse body, boolean created) {}
