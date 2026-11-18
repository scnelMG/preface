package com.preface.api.admin.service;

import com.preface.api.capture.service.StorageProperties;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.S3Object;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;

/**
 * {@link AdminStorage}의 S3 구현. S3 클라이언트·presigner·버킷 설정은 업로드 기능(capture)의 것을 같이 쓴다(의존 방향 admin →
 * capture 하나).
 *
 * <p>나열은 ListObjectsV2(IAM {@code s3:ListBucket})를 회원 prefix로만 부른다.
 */
@Component
@RequiredArgsConstructor
class S3AdminStorage implements AdminStorage {

    /** 관리자 화면 서명 URL 만료(계약: 5분). */
    static final Duration URL_TTL = Duration.ofMinutes(5);

    /** ListObjectsV2 한 번에 받는 최대 수(S3 상한). */
    private static final int PAGE_MAX = 1000;

    private final S3Client s3Client;
    private final S3Presigner presigner;
    private final StorageProperties storage;

    @Override
    public SignedUrl presignGet(String objectKey) {
        PresignedGetObjectRequest presigned =
                presigner.presignGetObject(
                        r ->
                                r.signatureDuration(URL_TTL)
                                        .getObjectRequest(
                                                g -> g.bucket(storage.bucket()).key(objectKey)));
        return new SignedUrl(presigned.url().toString(), presigned.expiration());
    }

    @Override
    public Listing list(String prefix, int maxObjects) {
        if (prefix == null || prefix.isBlank() || !prefix.endsWith("/")) {
            // 빈 prefix는 버킷 전체 나열이 된다(REQ-N-26)
            throw new IllegalArgumentException("prefix must be a non-empty folder");
        }
        List<StoredObject> objects = new ArrayList<>();
        String token = null;
        while (true) {
            int remaining = maxObjects - objects.size();
            ListObjectsV2Request.Builder request =
                    ListObjectsV2Request.builder()
                            .bucket(storage.bucket())
                            .prefix(prefix)
                            .maxKeys(Math.min(PAGE_MAX, remaining + 1));
            if (token != null) {
                request.continuationToken(token);
            }
            ListObjectsV2Response response = s3Client.listObjectsV2(request.build());
            for (S3Object object : response.contents()) {
                if (objects.size() == maxObjects) {
                    return new Listing(objects, true);
                }
                objects.add(
                        new StoredObject(
                                object.key(),
                                object.size() == null ? 0L : object.size(),
                                object.lastModified()));
            }
            if (!Boolean.TRUE.equals(response.isTruncated())) {
                return new Listing(objects, false);
            }
            if (objects.size() == maxObjects) {
                return new Listing(objects, true);
            }
            token = response.nextContinuationToken();
        }
    }
}
