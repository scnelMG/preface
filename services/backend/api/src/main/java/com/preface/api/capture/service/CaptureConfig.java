package com.preface.api.capture.service;

import java.net.URI;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * capture 영역 설정. global.config가 아니라 여기 두는 이유: global이 capture 설정 클래스를 알면 capture → global(보안)과 순환이
 * 생긴다.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({
    UploadProperties.class,
    StorageProperties.class,
    CaptureProperties.class
})
class CaptureConfig {

    /** 서명만 하는 객체라 만들 때·서명할 때 네트워크를 쓰지 않는다. */
    @Bean(destroyMethod = "close")
    S3Presigner s3Presigner(StorageProperties storage) {
        return presigner(storage);
    }

    /** 객체 확인·삭제(HEAD·DELETE)용. 복원 작업 생성 때 업로드된 영상을 확인한다. */
    @Bean(destroyMethod = "close")
    S3Client s3Client(StorageProperties storage) {
        S3ClientBuilder builder =
                S3Client.builder()
                        .region(Region.of(storage.region()))
                        .serviceConfiguration(
                                S3Configuration.builder()
                                        .pathStyleAccessEnabled(storage.pathStyleAccess())
                                        .build());
        if (storage.hasEndpoint()) {
            builder.endpointOverride(URI.create(storage.endpoint()));
        }
        builder.credentialsProvider(
                storage.hasStaticCredentials()
                        ? StaticCredentialsProvider.create(
                                AwsBasicCredentials.create(
                                        storage.accessKey(), storage.secretKey()))
                        : DefaultCredentialsProvider.builder().build());
        return builder.build();
    }

    static S3Presigner presigner(StorageProperties storage) {
        S3Presigner.Builder builder =
                S3Presigner.builder()
                        .region(Region.of(storage.region()))
                        .serviceConfiguration(
                                S3Configuration.builder()
                                        .pathStyleAccessEnabled(storage.pathStyleAccess())
                                        .build());
        if (storage.hasEndpoint()) {
            builder.endpointOverride(URI.create(storage.endpoint()));
        }
        builder.credentialsProvider(
                storage.hasStaticCredentials()
                        ? StaticCredentialsProvider.create(
                                AwsBasicCredentials.create(
                                        storage.accessKey(), storage.secretKey()))
                        : DefaultCredentialsProvider.builder().build());
        return builder.build();
    }
}
