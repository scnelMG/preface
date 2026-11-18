package com.preface.jobmanager.global.config;

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

/** 삭제 작업용 S3 클라이언트(DeleteObject만 쓴다). 만드는 방식은 api {@code CaptureConfig}와 같다. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(StorageProperties.class)
class StorageConfig {

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
}
