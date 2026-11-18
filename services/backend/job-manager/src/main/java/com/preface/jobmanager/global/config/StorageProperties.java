package com.preface.jobmanager.global.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * S3 호환 스토리지({@code preface.storage.*}). api의 같은 이름 설정과 같은 환경 변수를 쓴다. 키는 환경 변수로만 받는다.
 *
 * <p>api 쪽 클래스를 쓰지 않는 이유: job-manager는 api 모듈에 의존하지 않는다(별도 프로세스, common만 공유).
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
