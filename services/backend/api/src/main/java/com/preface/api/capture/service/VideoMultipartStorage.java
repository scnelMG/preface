package com.preface.api.capture.service;

import com.preface.common.capture.entity.FaceUpload;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.ChecksumAlgorithm;
import software.amazon.awssdk.services.s3.model.CompletedPart;
import software.amazon.awssdk.services.s3.model.NoSuchUploadException;
import software.amazon.awssdk.services.s3.model.ServerSideEncryption;

/**
 * 얼굴 영상 multipart 업로드의 S3 호출(S15P31B204-506). 조각 바이트는 FE가 presigned URL로 S3에 직접 올리고, 서버는 시작·완료·취소만
 * 한다.
 */
@Component
@RequiredArgsConstructor
class VideoMultipartStorage {

    private final S3Client s3Client;
    private final StorageProperties storage;

    /**
     * 업로드를 연다. SSE·SHA-256 체크섬 방식·기대 composite 체크섬(메타데이터)은 여기서 정해져 완성된 객체에 그대로 남는다.
     *
     * @return S3 UploadId
     */
    String create(String objectKey, String contentType, String expectedComposite) {
        return s3Client.createMultipartUpload(
                        r ->
                                r.bucket(storage.bucket())
                                        .key(objectKey)
                                        .contentType(contentType)
                                        .serverSideEncryption(ServerSideEncryption.AES256)
                                        .checksumAlgorithm(ChecksumAlgorithm.SHA256)
                                        .metadata(
                                                Map.of(
                                                        FaceUpload.EXPECTED_COMPOSITE_CHECKSUM_META,
                                                        expectedComposite)))
                .uploadId();
    }

    /**
     * 조각을 이어 붙인다. S3가 각 조각의 ETag·SHA-256을 확인한다.
     *
     * @return 완성된 객체의 composite 체크섬({@code base64-조각수})
     */
    String complete(String objectKey, String s3UploadId, List<CompletedPart> parts) {
        return s3Client.completeMultipartUpload(
                        r ->
                                r.bucket(storage.bucket())
                                        .key(objectKey)
                                        .uploadId(s3UploadId)
                                        .multipartUpload(m -> m.parts(parts)))
                .checksumSHA256();
    }

    /** 이미 끝났거나 지워진 업로드면 조용히 넘어간다. */
    void abort(String objectKey, String s3UploadId) {
        try {
            s3Client.abortMultipartUpload(
                    r -> r.bucket(storage.bucket()).key(objectKey).uploadId(s3UploadId));
        } catch (NoSuchUploadException e) {
            // 멱등
        }
    }

    void delete(String objectKey) {
        s3Client.deleteObject(r -> r.bucket(storage.bucket()).key(objectKey));
    }
}
