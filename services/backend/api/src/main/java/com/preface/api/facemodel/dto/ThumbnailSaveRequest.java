package com.preface.api.facemodel.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 올린 썸네일 저장 확인(S15P31B204-436, 가안). 업로드 URL 요청 때와 같은 key·크기·체크섬. */
public record ThumbnailSaveRequest(
        @NotBlank @Size(max = 500) String objectKey,
        @Min(1) @Max(300_000) long sizeBytes,
        @NotBlank @Size(max = 44) String checksumSha256) {}
