package com.preface.api.admin.service;

import java.time.Instant;
import java.util.List;

/**
 * 관리자 페이지의 S3 작업(S15P31B204-653). 구현은 {@link S3AdminStorage}(업로드 기능의 S3 설정을 같이 쓴다). 테스트는 이 인터페이스를
 * mock한다.
 *
 * <p>구현 주의: 서명 URL을 로그에 남기지 않는다. 만료는 5분(일반 화면의 10분보다 짧게).
 */
public interface AdminStorage {

    /** 읽기 전용 presigned GET(5분). */
    SignedUrl presignGet(String objectKey);

    /**
     * {@code prefix} 아래 객체를 key 순으로 최대 {@code maxObjects}개 나열한다. 더 있으면 {@link Listing#truncated()}가
     * 참이다. prefix 밖(버킷 전체)은 나열하지 않는다(REQ-N-26).
     */
    Listing list(String prefix, int maxObjects);

    /** 서명 URL. {@link #toString()}은 URL을 가린다. */
    record SignedUrl(String url, Instant expiresAt) {

        @Override
        public String toString() {
            return "SignedUrl[url=<redacted>, expiresAt=" + expiresAt + "]";
        }
    }

    record StoredObject(String key, long size, Instant lastModified) {}

    record Listing(List<StoredObject> objects, boolean truncated) {

        public Listing {
            objects = List.copyOf(objects);
        }
    }
}
