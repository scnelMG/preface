package com.preface.api.capture.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.capture.dto.MultipartCompleteRequest;
import com.preface.api.capture.dto.MultipartPartUrl;
import com.preface.api.capture.dto.MultipartStartRequest;
import com.preface.api.capture.dto.MultipartStartResponse;
import com.preface.common.capture.entity.CaptureMethod;
import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.entity.FaceUploadStatus;
import com.preface.common.capture.repository.FaceUploadRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CaptureErrorCode;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.response.ErrorBody;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import software.amazon.awssdk.awscore.exception.AwsErrorDetails;
import software.amazon.awssdk.services.s3.model.CompletedPart;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** 서명은 실제 SDK로(네트워크 없음), S3 호출·Redis는 가짜로 둔다. 체크섬은 모두 합성 값이다. */
class MultipartUploadServiceTest {

    private static final String USER_ID = "00000000-0000-0000-0000-000000000001";
    private static final String OTHER_USER = "00000000-0000-0000-0000-000000000002";
    private static final long PART = 8L * 1024 * 1024;

    /** SHA-256("hello"), SHA-256("world")와 그 composite. 기대값은 Python hashlib로 따로 계산했다. */
    private static final String HELLO = "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=";

    private static final String WORLD = "SG6kYiTRu0+2gPNPfJrZao8k7Ii+c+qOWmxlJg6cuKc=";
    private static final String COMPOSITE = "cwXbmyq8zXBsJW2z2X5f9I1nfP5NOlkEr7faDjlQ4eI=-2";
    private static final String FULL = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    private final UploadProperties properties =
            new UploadProperties(
                    Duration.ofMinutes(10),
                    new UploadProperties.Video(
                            List.of("video/mp4", "video/webm", "video/quicktime"),
                            262_144_000L,
                            15_000,
                            60_000,
                            20_000),
                    PART);
    private final StorageProperties storageProps =
            new StorageProperties(
                    "http://localhost:9000",
                    "ap-northeast-2",
                    "preface-test",
                    "unit-fake-access-key",
                    "unit-fake-secret-key",
                    true);
    private final S3Presigner s3Presigner = CaptureConfig.presigner(storageProps);
    private final CaptureGuard guard = mock(CaptureGuard.class);
    private final VideoMultipartStorage s3 = mock(VideoMultipartStorage.class);
    private final MultipartUploadStore store = mock(MultipartUploadStore.class);
    private final FaceUploadRepository repository = mock(FaceUploadRepository.class);
    private final Map<String, MultipartUploadStore.State> redis = new HashMap<>();
    private final MultipartUploadService service =
            new MultipartUploadService(
                    guard,
                    properties,
                    new VideoUploadPresigner(s3Presigner, storageProps),
                    s3,
                    store,
                    repository);

    @BeforeEach
    void fakes() {
        doAnswer(inv -> redis.put(inv.getArgument(0), inv.getArgument(1)))
                .when(store)
                .save(anyString(), any());
        when(store.find(anyString()))
                .thenAnswer(inv -> Optional.ofNullable(redis.get(inv.<String>getArgument(0))));
        doAnswer(inv -> redis.remove(inv.<String>getArgument(0))).when(store).delete(anyString());
        when(s3.create(anyString(), anyString(), anyString())).thenReturn("s3-upload-1");
        when(repository.save(any(FaceUpload.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @AfterEach
    void close() {
        s3Presigner.close();
    }

    @Test
    void composite_체크섬은_조각_digest를_이어_붙인_SHA256과_조각_수다() {
        assertThat(MultipartUploadService.composite(List.of(HELLO, WORLD))).isEqualTo(COMPOSITE);
    }

    @Test
    void 큰_영상이면_조각마다_크기와_체크섬을_서명한_URL을_주고_기대_composite를_넣어_업로드를_연다() {
        long size = PART + 1_000;

        MultipartStartResponse response = service.start(USER_ID, start(size, HELLO, WORLD));

        verify(s3).create(anyString(), eq("video/mp4"), eq(COMPOSITE));
        assertThat(response.partSizeBytes()).isEqualTo(PART);
        assertThat(response.parts()).extracting(MultipartPartUrl::partNumber).containsExactly(1, 2);
        MultipartPartUrl second = response.parts().get(1);
        URI url = URI.create(second.url());
        assertThat(url.getPath())
                .isEqualTo(
                        "/preface-test/users/"
                                + USER_ID
                                + "/uploads/"
                                + response.uploadId()
                                + ".mp4");
        assertThat(url.getQuery()).contains("partNumber=2").contains("uploadId=s3-upload-1");
        assertThat(second.headers()).containsEntry("x-amz-checksum-sha256", WORLD);
        assertThat(second.headers().keySet())
                .noneMatch(h -> h.equalsIgnoreCase("host") || h.equalsIgnoreCase("content-length"));
        assertThat(second.toString()).doesNotContain("X-Amz-Signature");
        assertThat(redis.get(response.uploadId()).partSize(2)).isEqualTo(1_000);

        ArgumentCaptor<FaceUpload> saved = ArgumentCaptor.forClass(FaceUpload.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().getStatus()).isEqualTo(FaceUploadStatus.ISSUED);
        assertThat(saved.getValue().getChecksumSha256()).isEqualTo(FULL);
    }

    @Test
    void 한_조각이거나_조각_수가_조각_크기와_다르면_COMMON_001이고_업로드를_열지_않는다() {
        assertThatThrownBy(() -> service.start(USER_ID, start(PART, HELLO)))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
        assertThatThrownBy(() -> service.start(USER_ID, start(PART * 2 + 1, HELLO, WORLD)))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
        verify(s3, never()).create(anyString(), anyString(), anyString());
    }

    @Test
    void 형식_크기_길이_정책은_CAP_01과_같이_CAP_002() {
        MultipartStartRequest tooLong =
                new MultipartStartRequest(
                        "video/mp4",
                        PART + 1,
                        90_000,
                        FULL,
                        List.of(HELLO, WORLD),
                        "WEB_RECORDER",
                        null,
                        null);

        assertThatThrownBy(() -> service.start(USER_ID, tooLong))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(CaptureErrorCode.UPLOAD_POLICY_VIOLATION);
    }

    @Test
    void 웹_녹화면_업로드를_열고_촬영_방식과_기종을_남긴다() {
        service.start(
                USER_ID,
                new MultipartStartRequest(
                        "video/mp4",
                        PART + 1,
                        20_000,
                        FULL,
                        List.of(HELLO, WORLD),
                        "WEB_RECORDER",
                        "SM-S921N",
                        null));

        ArgumentCaptor<FaceUpload> saved = ArgumentCaptor.forClass(FaceUpload.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().getCaptureMethod()).isEqualTo(CaptureMethod.WEB_RECORDER);
        assertThat(saved.getValue().getDeviceModel()).isEqualTo("SM-S921N");
    }

    @Test
    void 파일_올리기나_촬영_방식이_없으면_CAP_002이고_업로드를_열지_않는다() {
        for (String method : new String[] {"FILE", null, ""}) {
            MultipartStartRequest request =
                    new MultipartStartRequest(
                            "video/mp4",
                            PART + 1,
                            20_000,
                            FULL,
                            List.of(HELLO, WORLD),
                            method,
                            null,
                            null);

            assertThatThrownBy(() -> service.start(USER_ID, request))
                    .as("captureMethod=%s", method)
                    .isInstanceOfSatisfying(
                            BusinessException.class,
                            e -> {
                                assertThat(e.errorCode())
                                        .isEqualTo(CaptureErrorCode.UPLOAD_POLICY_VIOLATION);
                                assertThat(e.details())
                                        .extracting(ErrorBody.FieldError::field)
                                        .containsExactly("captureMethod");
                            });
        }
        verify(s3, never()).create(anyString(), anyString(), anyString());
        verify(repository, never()).save(any());
    }

    @Test
    void 완료는_조각_체크섬을_붙여_S3에_넘기고_다시_불러도_한_번만_합친다() {
        String uploadId = service.start(USER_ID, start(PART + 1, HELLO, WORLD)).uploadId();
        when(s3.complete(anyString(), eq("s3-upload-1"), anyList())).thenReturn(COMPOSITE);

        service.complete(USER_ID, uploadId, complete(2, 1));
        service.complete(USER_ID, uploadId, complete(1, 2));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<CompletedPart>> parts = ArgumentCaptor.forClass(List.class);
        verify(s3, times(1)).complete(anyString(), eq("s3-upload-1"), parts.capture());
        assertThat(parts.getValue())
                .extracting(CompletedPart::partNumber, CompletedPart::checksumSHA256)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(1, HELLO),
                        org.assertj.core.groups.Tuple.tuple(2, WORLD));
        assertThat(redis.get(uploadId).completed()).isTrue();
    }

    @Test
    void 조각이_빠지면_CAP_003_같은_번호가_두_번이면_COMMON_001() {
        String uploadId = service.start(USER_ID, start(PART + 1, HELLO, WORLD)).uploadId();

        assertThatThrownBy(() -> service.complete(USER_ID, uploadId, complete(1)))
                .extracting("errorCode")
                .isEqualTo(CaptureErrorCode.UPLOAD_OBJECT_MISSING);
        assertThatThrownBy(() -> service.complete(USER_ID, uploadId, complete(1, 1)))
                .extracting("errorCode")
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
        verify(s3, never()).complete(anyString(), anyString(), anyList());
    }

    @Test
    void S3가_조각을_못_찾으면_CAP_003() {
        String uploadId = service.start(USER_ID, start(PART + 1, HELLO, WORLD)).uploadId();
        when(s3.complete(anyString(), anyString(), anyList())).thenThrow(s3Error("InvalidPart"));

        assertThatThrownBy(() -> service.complete(USER_ID, uploadId, complete(1, 2)))
                .extracting("errorCode")
                .isEqualTo(CaptureErrorCode.UPLOAD_OBJECT_MISSING);
    }

    @Test
    void 합친_객체의_composite가_기대값과_다르면_객체를_지우고_CAP_005() {
        String uploadId = service.start(USER_ID, start(PART + 1, HELLO, WORLD)).uploadId();
        when(s3.complete(anyString(), anyString(), anyList())).thenReturn("different-2");

        assertThatThrownBy(() -> service.complete(USER_ID, uploadId, complete(1, 2)))
                .extracting("errorCode")
                .isEqualTo(CaptureErrorCode.UPLOAD_CHECKSUM_MISMATCH);
        verify(s3).delete(anyString());
        assertThat(redis).doesNotContainKey(uploadId);
    }

    @Test
    void 남의_업로드는_COMMON_002이고_없는_업로드는_CAP_004() {
        String uploadId = service.start(USER_ID, start(PART + 1, HELLO, WORLD)).uploadId();

        assertThatThrownBy(() -> service.presignParts(OTHER_USER, uploadId, List.of(1)))
                .extracting("errorCode")
                .isEqualTo(CommonErrorCode.NOT_FOUND);
        assertThatThrownBy(() -> service.complete(USER_ID, "no-such-upload", complete(1, 2)))
                .extracting("errorCode")
                .isEqualTo(CaptureErrorCode.UPLOAD_EXPIRED);
    }

    @Test
    void 조각_URL을_다시_받으면_요청한_번호만_새로_서명한다() {
        String uploadId = service.start(USER_ID, start(PART + 1, HELLO, WORLD)).uploadId();

        var response = service.presignParts(USER_ID, uploadId, List.of(2, 2));

        assertThat(response.parts()).extracting(MultipartPartUrl::partNumber).containsExactly(2);
        assertThatThrownBy(() -> service.presignParts(USER_ID, uploadId, List.of(3)))
                .extracting("errorCode")
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
    }

    @Test
    void 취소는_끝나지_않은_업로드를_S3에서_버리고_없는_업로드도_성공한다() {
        String uploadId = service.start(USER_ID, start(PART + 1, HELLO, WORLD)).uploadId();

        service.abort(USER_ID, uploadId);
        service.abort(USER_ID, uploadId);

        verify(s3, times(1)).abort(anyString(), eq("s3-upload-1"));
        assertThat(redis).doesNotContainKey(uploadId);
    }

    private static MultipartStartRequest start(long size, String... parts) {
        return new MultipartStartRequest(
                "video/mp4", size, 20_000, FULL, List.of(parts), "WEB_RECORDER", null, null);
    }

    private static MultipartCompleteRequest complete(int... partNumbers) {
        List<MultipartCompleteRequest.Part> parts = new ArrayList<>();
        for (int n : partNumbers) {
            parts.add(new MultipartCompleteRequest.Part(n, "\"etag-" + n + "\""));
        }
        return new MultipartCompleteRequest(parts);
    }

    private static S3Exception s3Error(String code) {
        return (S3Exception)
                S3Exception.builder()
                        .statusCode(400)
                        .awsErrorDetails(AwsErrorDetails.builder().errorCode(code).build())
                        .build();
    }
}
