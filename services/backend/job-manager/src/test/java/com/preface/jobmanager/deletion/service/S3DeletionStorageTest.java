package com.preface.jobmanager.deletion.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.jobmanager.global.config.StorageProperties;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;

/** S3 삭제: 이미 없는 객체는 성공, 그 밖의 오류는 예외(재시도 대상). S3 클라이언트는 mock. */
class S3DeletionStorageTest {

    private static final String KEY = "users/synthetic/uploads/synthetic.mp4";

    private final S3Client s3 = mock(S3Client.class);
    private final S3DeletionStorage storage =
            new S3DeletionStorage(
                    s3,
                    new StorageProperties(
                            null, "ap-northeast-2", "preface-test", null, null, false));

    @Test
    void 객체가_이미_없어서_NoSuchKey나_404가_오면_성공으로_본다() {
        deleteThrows(NoSuchKeyException.builder().statusCode(404).build());
        assertThatCode(() -> storage.delete(KEY)).doesNotThrowAnyException();

        deleteThrows(S3Exception.builder().statusCode(404).build());
        assertThatCode(() -> storage.delete(KEY)).doesNotThrowAnyException();
    }

    @Test
    void 권한_오류_등_다른_실패는_예외를_던진다() {
        deleteThrows(S3Exception.builder().statusCode(403).build());
        assertThatThrownBy(() -> storage.delete(KEY)).isInstanceOf(S3Exception.class);
    }

    @SuppressWarnings("unchecked")
    private void deleteThrows(RuntimeException e) {
        when(s3.deleteObject(any(Consumer.class))).thenThrow(e);
    }
}
