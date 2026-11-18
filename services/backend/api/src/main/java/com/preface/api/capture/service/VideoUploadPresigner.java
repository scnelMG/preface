package com.preface.api.capture.service;

import java.net.URL;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.ServerSideEncryption;
import software.amazon.awssdk.services.s3.model.UploadPartRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedUploadPartRequest;

/**
 * 얼굴 영상 presigned PUT URL.
 *
 * <p>Content-Type·Content-Length·SSE·SHA-256을 서명에 넣는다. 그래서 FE가 선언과 다른 형식·크기·내용을 올리거나 암호화 헤더를 빼면 S3가
 * 거부한다(FN-CAP-02 수용 2·4). URL에는 서명이 들어 있으므로 로그에 남기지 않는다.
 */
@Component
@RequiredArgsConstructor
class VideoUploadPresigner {

    /** 브라우저가 직접 붙이거나(Host, Content-Length) 붙일 수 없는 헤더. 응답 headers에서 뺀다. */
    private static final List<String> BROWSER_MANAGED = List.of("host", "content-length");

    private final S3Presigner presigner;
    private final StorageProperties storage;

    PresignedUpload presignPut(
            String objectKey, String contentType, long sizeBytes, String checksum, Duration ttl) {
        PutObjectRequest put =
                PutObjectRequest.builder()
                        .bucket(storage.bucket())
                        .key(objectKey)
                        .contentType(contentType)
                        .contentLength(sizeBytes)
                        .serverSideEncryption(ServerSideEncryption.AES256)
                        .checksumSHA256(checksum)
                        .build();
        PresignedPutObjectRequest presigned =
                presigner.presignPutObject(r -> r.signatureDuration(ttl).putObjectRequest(put));
        return toUpload(presigned.url(), presigned.expiration(), presigned.signedHeaders());
    }

    /**
     * multipart 조각 하나(S15P31B204-506). Content-Length·조각 SHA-256을 서명에 넣어 S3가 선언과 다른 조각을 거부한다. SSE는
     * 업로드 시작 때 정해서 조각에는 넣지 않는다(SSE-S3는 UploadPart 헤더를 받지 않는다).
     */
    PresignedUpload presignPart(
            String objectKey,
            String s3UploadId,
            int partNumber,
            long sizeBytes,
            String checksum,
            Duration ttl) {
        UploadPartRequest part =
                UploadPartRequest.builder()
                        .bucket(storage.bucket())
                        .key(objectKey)
                        .uploadId(s3UploadId)
                        .partNumber(partNumber)
                        .contentLength(sizeBytes)
                        .checksumSHA256(checksum)
                        .build();
        PresignedUploadPartRequest presigned =
                presigner.presignUploadPart(r -> r.signatureDuration(ttl).uploadPartRequest(part));
        return toUpload(presigned.url(), presigned.expiration(), presigned.signedHeaders());
    }

    private static PresignedUpload toUpload(
            URL url, Instant expiresAt, Map<String, List<String>> signedHeaders) {
        Map<String, String> headers = new LinkedHashMap<>();
        signedHeaders.forEach(
                (name, values) -> {
                    if (!BROWSER_MANAGED.contains(name.toLowerCase())) {
                        headers.put(
                                name.equalsIgnoreCase("content-type") ? "Content-Type" : name,
                                String.join(",", values));
                    }
                });
        return new PresignedUpload(url.toString(), expiresAt, Map.copyOf(headers));
    }

    /** {@code url}은 서명 원문이다. toString에 넣지 않는다. */
    record PresignedUpload(String url, Instant expiresAt, Map<String, String> headers) {

        @Override
        public String toString() {
            return "PresignedUpload[url=***, expiresAt=" + expiresAt + "]";
        }
    }
}
