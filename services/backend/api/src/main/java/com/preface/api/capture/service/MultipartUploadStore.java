package com.preface.api.capture.service;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * 진행 중인 multipart 업로드(S15P31B204-506). Redis만 쓴다(DB 컬럼 없음): 완료 뒤에는 쓸 일이 없는 값이라서다.
 *
 * <pre>
 * capture:multipart:{uploadId}   STRING JSON {@link State}. TTL 24시간
 * </pre>
 *
 * <p>TTL은 버킷 lifecycle(미완료 multipart 1일 뒤 정리, {@code infra/aws/s3-setup.sh})과 업로드 원본 보관(URL 만료 +
 * 24시간)에 맞춘다.
 */
@Component
@RequiredArgsConstructor
class MultipartUploadStore {

    static final Duration TTL = Duration.ofHours(24);
    private static final String PREFIX = "capture:multipart:";

    private final StringRedisTemplate redis;
    private final JsonMapper json;

    /**
     * @param partChecksums 조각 순서대로 SHA-256(base64)
     * @param completed S3 CompleteMultipartUpload까지 끝났다(완료 요청 재시도를 멱등으로 받으려고 남긴다)
     */
    record State(
            String userId,
            String objectKey,
            String s3UploadId,
            long sizeBytes,
            long partSizeBytes,
            List<String> partChecksums,
            boolean completed) {

        int partCount() {
            return partChecksums.size();
        }

        /** 조각 크기. 마지막 조각만 작다. */
        long partSize(int partNumber) {
            return partNumber < partCount()
                    ? partSizeBytes
                    : sizeBytes - partSizeBytes * (partCount() - 1);
        }

        State complete() {
            return new State(
                    userId, objectKey, s3UploadId, sizeBytes, partSizeBytes, partChecksums, true);
        }
    }

    void save(String uploadId, State state) {
        redis.opsForValue().set(PREFIX + uploadId, json.writeValueAsString(state), TTL);
    }

    Optional<State> find(String uploadId) {
        String value = redis.opsForValue().get(PREFIX + uploadId);
        return value == null ? Optional.empty() : Optional.of(json.readValue(value, State.class));
    }

    void delete(String uploadId) {
        redis.delete(PREFIX + uploadId);
    }
}
