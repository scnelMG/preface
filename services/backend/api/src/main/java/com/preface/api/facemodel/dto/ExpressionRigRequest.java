package com.preface.api.facemodel.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 기존 모델 표정 트래킹 리그 보충(S15P31B204-879). 작업자가 그 모델 메시와 같은 폴더에 올린 {@code expression.json} key. */
public record ExpressionRigRequest(@NotBlank @Size(max = 500) String objectKey) {}
