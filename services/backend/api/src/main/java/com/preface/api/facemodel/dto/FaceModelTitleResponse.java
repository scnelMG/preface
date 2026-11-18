package com.preface.api.facemodel.dto;

import java.time.Instant;

/** 내 머리 이름 바꾸기 응답. */
public record FaceModelTitleResponse(String faceModelId, String title, Instant updatedAt) {}
