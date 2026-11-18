package com.preface.api.reconstruction.service;

import java.time.Instant;
import java.util.Map;

/**
 * 복원에 필요한 S3 작업. 구현은 {@link S3ReconstructionStorage}(업로드 기능의 S3 설정을 같이 쓴다). 테스트는 이 인터페이스를 mock한다.
 *
 * <p>구현 주의: 반환하는 URL을 로그에 남기지 않는다. 만료는 10분(REQ-N-04).
 */
public interface ReconstructionStorage {

    /** API-REC-01: 객체 존재·크기·SHA-256 확인(S3 HEAD). 체크섬이 다르면 구현이 객체를 지운다. */
    UploadCheck checkUpload(String objectKey, long sizeBytes, String checksumSha256);

    /** INT-REC-01: 원본 영상 presigned GET. */
    PresignedUrl presignGet(String objectKey);

    /** Internal model asset validation only. Never return these bytes to a client. */
    byte[] readMesh(String objectKey);

    /** INT-REC-04: 결과 객체 presigned PUT(SSE 헤더 포함). */
    PresignedUrl presignPut(String objectKey, String contentType);

    /**
     * INT-EXT-02: 크기·SHA-256을 서명에 넣은 presigned PUT(SSE 포함). 다른 파일을 올리면 S3가 거절한다(원본 영상 업로드와 같은 방식).
     */
    PresignedUrl presignPut(
            String objectKey, String contentType, long sizeBytes, String checksumSha256);

    enum UploadCheck {
        PRESENT,
        MISSING,
        CHECKSUM_MISMATCH
    }

    /** 서명 URL. {@link #toString()}은 URL을 가린다. */
    record PresignedUrl(String url, Map<String, String> headers, Instant expiresAt) {

        @Override
        public String toString() {
            return "PresignedUrl[url=<redacted>, expiresAt=" + expiresAt + "]";
        }
    }
}
