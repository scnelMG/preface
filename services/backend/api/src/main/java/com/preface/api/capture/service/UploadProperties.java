package com.preface.api.capture.service;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 영상 업로드 정책({@code preface.upload.*}). API-CAP-01 검증과 API-CAP-02 응답이 이 값 하나를 함께 쓴다(정책 단일 출처,
 * FN-CAP-02 수용 5).
 *
 * @param urlTtl presigned PUT URL 만료. 10분(REQ-N-04)
 * @param partSizeBytes multipart 업로드 조각 크기(S15P31B204-506). S3 최소 5MiB, 기본 8MiB. 이보다 작은 파일은 PUT 한
 *     번(CAP-01)
 */
@ConfigurationProperties("preface.upload")
public record UploadProperties(Duration urlTtl, Video video, long partSizeBytes) {

    /** S3 multipart 조각 최소 크기(마지막 조각 제외). */
    public static final long MIN_PART_SIZE_BYTES = 5L * 1024 * 1024;

    public UploadProperties {
        partSizeBytes = partSizeBytes <= 0 ? 8L * 1024 * 1024 : partSizeBytes;
        if (partSizeBytes < MIN_PART_SIZE_BYTES) {
            throw new IllegalArgumentException("preface.upload.part-size-bytes must be >= 5MiB");
        }
    }

    public record Video(
            List<String> allowedContentTypes,
            long maxSizeBytes,
            int minDurationMs,
            int maxDurationMs,
            int recommendedDurationMs) {

        public Video {
            allowedContentTypes =
                    allowedContentTypes == null ? List.of() : List.copyOf(allowedContentTypes);
        }
    }
}
