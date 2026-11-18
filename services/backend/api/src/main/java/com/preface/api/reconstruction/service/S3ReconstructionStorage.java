package com.preface.api.reconstruction.service;

import com.preface.api.capture.service.StorageProperties;
import com.preface.common.capture.entity.FaceUpload;
import java.io.IOException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.awscore.presigner.PresignedRequest;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.ChecksumMode;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.model.ServerSideEncryption;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * {@link ReconstructionStorage}의 S3 구현. S3 클라이언트·presigner·버킷 설정은 업로드 기능(capture)의 것을 같이 쓴다.
 *
 * <p>의존 방향은 reconstruction → capture 하나다(반대로 두면 도메인 패키지 순환 — ArchitectureTest).
 */
@Component
@RequiredArgsConstructor
class S3ReconstructionStorage implements ReconstructionStorage {

    /** presigned URL 만료(REQ-N-04). */
    private static final Duration URL_TTL = Duration.ofMinutes(10);

    private static final int MAX_MESH_BYTES = 64 * 1024 * 1024;

    /** HTTP 클라이언트가 직접 붙이는 헤더. 워커에 넘길 headers에서 뺀다. */
    private static final List<String> CLIENT_MANAGED = List.of("host", "content-length");

    private final S3Client s3Client;
    private final S3Presigner presigner;
    private final StorageProperties storage;

    @Override
    public UploadCheck checkUpload(String objectKey, long sizeBytes, String checksumSha256) {
        HeadObjectResponse head;
        try {
            head =
                    s3Client.headObject(
                            r ->
                                    r.bucket(storage.bucket())
                                            .key(objectKey)
                                            .checksumMode(ChecksumMode.ENABLED));
        } catch (NoSuchKeyException e) {
            return UploadCheck.MISSING;
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                return UploadCheck.MISSING;
            }
            throw e;
        }
        boolean sizeMatches = head.contentLength() != null && head.contentLength() == sizeBytes;
        boolean checksumMatches =
                checksumSha256 == null
                        || checksumSha256.equals(head.checksumSHA256())
                        || compositeMatches(head);
        if (!sizeMatches || !checksumMatches) {
            // 선언과 다른 객체는 쓰지 않는다. 지워서 다시 올리게 한다(CAP_005)
            s3Client.deleteObject(r -> r.bucket(storage.bucket()).key(objectKey));
            return UploadCheck.CHECKSUM_MISMATCH;
        }
        return UploadCheck.PRESENT;
    }

    /**
     * multipart 객체(S15P31B204-506)는 체크섬이 {@code base64-조각수} composite다. 업로드 시작 때 서버가 메타데이터에 넣은 기대값과
     * 같아야 한다. 전체 SHA-256은 프레임 추출기가 영상을 내려받아 다시 확인한다.
     */
    private static boolean compositeMatches(HeadObjectResponse head) {
        String actual = head.checksumSHA256();
        return actual != null
                && actual.contains("-")
                && actual.equals(head.metadata().get(FaceUpload.EXPECTED_COMPOSITE_CHECKSUM_META));
    }

    @Override
    public PresignedUrl presignGet(String objectKey) {
        return toUrl(
                presigner.presignGetObject(
                        r ->
                                r.signatureDuration(URL_TTL)
                                        .getObjectRequest(
                                                g -> g.bucket(storage.bucket()).key(objectKey))));
    }

    @Override
    public byte[] readMesh(String objectKey) {
        try (var body = s3Client.getObject(r -> r.bucket(storage.bucket()).key(objectKey))) {
            byte[] bytes = body.readNBytes(MAX_MESH_BYTES + 1);
            if (bytes.length > MAX_MESH_BYTES) throw new IllegalArgumentException("mesh too large");
            return bytes;
        } catch (IOException e) {
            throw new IllegalStateException("mesh read failed", e);
        }
    }

    @Override
    public PresignedUrl presignPut(String objectKey, String contentType) {
        PutObjectRequest put =
                PutObjectRequest.builder()
                        .bucket(storage.bucket())
                        .key(objectKey)
                        .contentType(contentType)
                        .serverSideEncryption(ServerSideEncryption.AES256)
                        .build();
        return toUrl(
                presigner.presignPutObject(
                        r -> r.signatureDuration(URL_TTL).putObjectRequest(put)));
    }

    @Override
    public PresignedUrl presignPut(
            String objectKey, String contentType, long sizeBytes, String checksumSha256) {
        PutObjectRequest put =
                PutObjectRequest.builder()
                        .bucket(storage.bucket())
                        .key(objectKey)
                        .contentType(contentType)
                        .contentLength(sizeBytes)
                        .serverSideEncryption(ServerSideEncryption.AES256)
                        .checksumSHA256(checksumSha256)
                        .build();
        return toUrl(
                presigner.presignPutObject(
                        r -> r.signatureDuration(URL_TTL).putObjectRequest(put)));
    }

    private static PresignedUrl toUrl(PresignedRequest presigned) {
        Map<String, String> headers = new LinkedHashMap<>();
        presigned
                .signedHeaders()
                .forEach(
                        (name, values) -> {
                            if (!CLIENT_MANAGED.contains(name.toLowerCase())) {
                                headers.put(name, String.join(",", values));
                            }
                        });
        return new PresignedUrl(
                presigned.url().toString(), Map.copyOf(headers), presigned.expiration());
    }
}
