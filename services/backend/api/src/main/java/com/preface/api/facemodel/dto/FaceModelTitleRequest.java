package com.preface.api.facemodel.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 내 머리 이름 바꾸기. 1~20자(팀장 확정 2026-10-27), 앞뒤 공백은 서버가 지운다(공백만이면 COMMON_001). */
public record FaceModelTitleRequest(@NotBlank @Size(max = 20) String title) {}
