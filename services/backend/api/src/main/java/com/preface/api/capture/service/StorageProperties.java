package com.preface.api.capture.service;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * S3 호환 스토리지({@code preface.storage.*}). 키는 환경 변수로만 받는다.
 *
 * @param endpoint 비우면 AWS S3 기본 주소. MinIO 등 S3 호환 스토리지면 그 주소
 * @param accessKey 비우면 AWS 기본 자격 증명 체인(ECS 작업 역할 등)을 쓴다
 * @param pathStyleAccess MinIO처럼 가상 호스트 방식을 못 쓰는 스토리지면 true
 */
@ConfigurationProperties("preface.storage")
public record StorageProperties(
        String endpoint,
        String region,
        String bucket,
        String accessKey,
        String secretKey,
        boolean pathStyleAccess) {

    public StorageProperties {
        if (bucket == null || bucket.isBlank()) {
            throw new IllegalStateException("preface.storage.bucket(S3_BUCKET) is required");
        }
        if (region == null || region.isBlank()) {
            throw new IllegalStateException("preface.storage.region(S3_REGION) is required");
        }
    }

    boolean hasStaticCredentials() {
        return accessKey != null && !accessKey.isBlank();
    }

    boolean hasEndpoint() {
        return endpoint != null && !endpoint.isBlank();
    }
}
