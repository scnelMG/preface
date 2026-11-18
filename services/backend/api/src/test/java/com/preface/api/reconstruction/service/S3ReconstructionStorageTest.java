package com.preface.api.reconstruction.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.capture.service.StorageProperties;
import com.preface.common.capture.entity.FaceUpload;
import java.net.URI;
import java.util.Map;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** S3 HEAD 결과 해석과 presign 결과(네트워크 없음). 실제 S3·MinIO 호출은 하지 않는다. */
class S3ReconstructionStorageTest {

    private static final String KEY = "users/u-1/uploads/up-1.mp4";
    private static final String CHECKSUM = "n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=";

    private final S3Client s3 = mock(S3Client.class);
    private final S3Presigner presigner =
            S3Presigner.builder()
                    .region(Region.AP_NORTHEAST_2)
                    .endpointOverride(URI.create("http://localhost:9000"))
                    .serviceConfiguration(
                            S3Configuration.builder().pathStyleAccessEnabled(true).build())
                    .credentialsProvider(
                            StaticCredentialsProvider.create(
                                    AwsBasicCredentials.create("unit-fake", "unit-fake-secret")))
                    .build();
    private final StorageProperties props =
            new StorageProperties(
                    "http://localhost:9000", "ap-northeast-2", "preface-unit", "", "", true);
    private final S3ReconstructionStorage storage =
            new S3ReconstructionStorage(s3, presigner, props);

    @AfterEach
    void close() {
        presigner.close();
    }

    @Test
    void 객체가_없으면_MISSING() {
        when(s3.headObject(any(Consumer.class))).thenThrow(NoSuchKeyException.builder().build());

        assertThat(storage.checkUpload(KEY, 10, CHECKSUM))
                .isEqualTo(ReconstructionStorage.UploadCheck.MISSING);
    }

    @Test
    void 크기와_체크섬이_같으면_PRESENT이고_지우지_않는다() {
        head(10L, CHECKSUM);

        assertThat(storage.checkUpload(KEY, 10, CHECKSUM))
                .isEqualTo(ReconstructionStorage.UploadCheck.PRESENT);
        verify(s3, never()).deleteObject(any(Consumer.class));
    }

    @Test
    void 체크섬이_다르면_객체를_지우고_CHECKSUM_MISMATCH() {
        head(10L, "different-checksum");

        assertThat(storage.checkUpload(KEY, 10, CHECKSUM))
                .isEqualTo(ReconstructionStorage.UploadCheck.CHECKSUM_MISMATCH);
        verify(s3).deleteObject(any(Consumer.class));
    }

    @Test
    void 크기가_다르면_객체를_지우고_CHECKSUM_MISMATCH() {
        head(11L, CHECKSUM);

        assertThat(storage.checkUpload(KEY, 10, CHECKSUM))
                .isEqualTo(ReconstructionStorage.UploadCheck.CHECKSUM_MISMATCH);
        verify(s3).deleteObject(any(Consumer.class));
    }

    @Test
    void multipart_객체는_composite_체크섬이_업로드_시작_때_넣은_기대값과_같으면_PRESENT() {
        multipartHead(
                10L,
                "cwXbmyq8zXBsJW2z2X5f9I1nfP5NOlkEr7faDjlQ4eI=-2",
                "cwXbmyq8zXBsJW2z2X5f9I1nfP5NOlkEr7faDjlQ4eI=-2");

        assertThat(storage.checkUpload(KEY, 10, CHECKSUM))
                .isEqualTo(ReconstructionStorage.UploadCheck.PRESENT);
        verify(s3, never()).deleteObject(any(Consumer.class));
    }

    @Test
    void multipart_객체라도_기대값이_없거나_다르면_지우고_CHECKSUM_MISMATCH() {
        multipartHead(10L, "cwXbmyq8zXBsJW2z2X5f9I1nfP5NOlkEr7faDjlQ4eI=-2", null);

        assertThat(storage.checkUpload(KEY, 10, CHECKSUM))
                .isEqualTo(ReconstructionStorage.UploadCheck.CHECKSUM_MISMATCH);
        verify(s3).deleteObject(any(Consumer.class));
    }

    @Test
    void presign_결과는_키를_가리키고_Host_헤더를_넘기지_않는다() {
        ReconstructionStorage.PresignedUrl get = storage.presignGet(KEY);
        ReconstructionStorage.PresignedUrl put =
                storage.presignPut("users/u-1/models/m-1.glb", "model/gltf-binary");

        assertThat(get.url()).contains("/preface-unit/" + KEY);
        assertThat(get.headers().keySet()).noneMatch(h -> h.equalsIgnoreCase("host"));
        assertThat(put.headers()).containsKey("x-amz-server-side-encryption");
        assertThat(put.toString()).doesNotContain("X-Amz-Signature");
    }

    @SuppressWarnings("unchecked")
    private void head(long size, String checksum) {
        when(s3.headObject(any(Consumer.class)))
                .thenReturn(
                        HeadObjectResponse.builder()
                                .contentLength(size)
                                .checksumSHA256(checksum)
                                .build());
    }

    @SuppressWarnings("unchecked")
    private void multipartHead(long size, String checksum, String expected) {
        when(s3.headObject(any(Consumer.class)))
                .thenReturn(
                        HeadObjectResponse.builder()
                                .contentLength(size)
                                .checksumSHA256(checksum)
                                .metadata(
                                        expected == null
                                                ? Map.of()
                                                : Map.of(
                                                        FaceUpload.EXPECTED_COMPOSITE_CHECKSUM_META,
                                                        expected))
                                .build());
    }
}
