package com.preface.api.facemodel.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 내 머리 썸네일 업로드 URL 요청(S15P31B204-436, 가안). 크기·SHA-256(base64)을 서명에 넣어 다른 파일은 S3가 거절한다.
 *
 * @param sizeBytes WebP 크기. 썸네일(320px)이라 300KB까지만 받는다
 */
public record ThumbnailUploadRequest(
        @Min(1) @Max(300_000) long sizeBytes, @NotBlank @Size(max = 44) String checksumSha256) {}
