package com.preface.api.capture.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.capture.dto.UploadPolicyResponse;
import com.preface.api.capture.dto.UploadRequest;
import com.preface.api.capture.dto.UploadResponse;
import com.preface.common.capture.entity.CaptureMethod;
import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.entity.FaceUploadStatus;
import com.preface.common.capture.repository.FaceUploadRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CaptureErrorCode;
import com.preface.common.response.ErrorBody;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** presign은 실제 SDK로 하되 네트워크 없이 서명만 확인한다(가짜 키·접속하지 않는 주소). */
class UploadServiceTest {

    private static final String USER_ID = "00000000-0000-0000-0000-000000000001";

    /** 합성 값: 형식(44자 base64)만 맞춘 임의 체크섬 */
    private static final String CHECKSUM = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    private final UploadProperties properties =
            new UploadProperties(
                    Duration.ofMinutes(10),
                    new UploadProperties.Video(
                            List.of("video/mp4", "video/webm", "video/quicktime"),
                            262_144_000L,
                            25_000,
                            45_000,
                            35_000),
                    8L * 1024 * 1024);
    private final StorageProperties storage =
            new StorageProperties(
                    "http://localhost:9000",
                    "ap-northeast-2",
                    "preface-test",
                    "unit-fake-access-key",
                    "unit-fake-secret-key",
                    true);
    private final S3Presigner s3Presigner = CaptureConfig.presigner(storage);
    private final CaptureGuard guard = mock(CaptureGuard.class);
    private final FaceUploadRepository repository = mock(FaceUploadRepository.class);
    private final UploadService service =
            new UploadService(
                    guard, properties, new VideoUploadPresigner(s3Presigner, storage), repository);

    @AfterEach
    void close() {
        s3Presigner.close();
    }

    @Test
    void 정책을_지키면_10분짜리_presigned_PUT_URL과_서명된_헤더를_주고_업로드를_ISSUED로_저장한다() {
        when(repository.save(any(FaceUpload.class))).thenAnswer(inv -> inv.getArgument(0));
        Instant before = Instant.now();

        UploadResponse response =
                service.issue(USER_ID, webRecorder("video/quicktime", 148_000_000L, 35_000));

        URI url = URI.create(response.uploadUrl());
        assertThat(url.getPath())
                .isEqualTo(
                        "/preface-test/users/"
                                + USER_ID
                                + "/uploads/"
                                + response.uploadId()
                                + ".mov");
        assertThat(url.getQuery()).contains("X-Amz-Expires=600");
        assertThat(url.getQuery())
                .contains("content-length")
                .contains("content-type")
                .contains("x-amz-checksum-sha256")
                .contains("x-amz-server-side-encryption");
        assertThat(response.method()).isEqualTo("PUT");
        assertThat(response.headers())
                .containsEntry("Content-Type", "video/quicktime")
                .containsEntry("x-amz-server-side-encryption", "AES256")
                .containsEntry("x-amz-checksum-sha256", CHECKSUM)
                .doesNotContainKeys("host", "Host", "content-length", "Content-Length");
        assertThat(response.expiresAt())
                .isBetween(
                        before.plus(Duration.ofMinutes(10)).minusSeconds(1),
                        Instant.now().plus(Duration.ofMinutes(10)).plusSeconds(1));
        assertThat(response.toString()).doesNotContain(response.uploadUrl());

        ArgumentCaptor<FaceUpload> saved = ArgumentCaptor.forClass(FaceUpload.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().getId()).isEqualTo(response.uploadId());
        assertThat(saved.getValue().getStatus()).isEqualTo(FaceUploadStatus.ISSUED);
        assertThat(saved.getValue().getUrlExpiresAt()).isEqualTo(response.expiresAt());
        assertThat(saved.getValue().getRetentionExpiresAt())
                .isEqualTo(response.expiresAt().plus(Duration.ofHours(24)));
    }

    @Test
    void 웹_녹화와_기종을_보내면_업로드에_남기고_기종이_없으면_null이다() {
        when(repository.save(any(FaceUpload.class))).thenAnswer(inv -> inv.getArgument(0));

        service.issue(
                USER_ID,
                new UploadRequest(
                        "video/mp4", 1000L, 35_000, CHECKSUM, "WEB_RECORDER", " SM-S921N "));
        service.issue(USER_ID, webRecorder("video/mp4", 1000L, 35_000));

        ArgumentCaptor<FaceUpload> saved = ArgumentCaptor.forClass(FaceUpload.class);
        verify(repository, org.mockito.Mockito.times(2)).save(saved.capture());
        assertThat(saved.getAllValues().get(0).getCaptureMethod())
                .isEqualTo(CaptureMethod.WEB_RECORDER);
        assertThat(saved.getAllValues().get(0).getDeviceModel()).isEqualTo("SM-S921N");
        assertThat(saved.getAllValues().get(1).getCaptureMethod())
                .isEqualTo(CaptureMethod.WEB_RECORDER);
        assertThat(saved.getAllValues().get(1).getDeviceModel()).isNull();
    }

    @Test
    void 웹_녹화_촬영_기록은_업로드에_남긴다() {
        when(repository.save(any(FaceUpload.class))).thenAnswer(inv -> inv.getArgument(0));
        tools.jackson.databind.JsonNode trace =
                tools.jackson.databind.json.JsonMapper.builder()
                        .build()
                        .readTree("{\"version\":1,\"trace\":[[0,1.5,-2.0,1],[50,2.0,-2.0,1]]}");

        service.issue(
                USER_ID,
                new UploadRequest(
                        "video/mp4", 1000L, 35_000, CHECKSUM, "WEB_RECORDER", null, trace));

        ArgumentCaptor<FaceUpload> saved = ArgumentCaptor.forClass(FaceUpload.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().getCaptureTrace()).contains("\"trace\"");
    }

    @Test
    void 파일_올리기나_촬영_방식이_없는_업로드는_CAP_002로_거절하고_저장하지_않는다() {
        for (String method : new String[] {"FILE", null, "", "web_recorder"}) {
            UploadRequest request =
                    new UploadRequest("video/mp4", 1000L, 35_000, CHECKSUM, method, null);

            assertThatThrownBy(() -> service.issue(USER_ID, request))
                    .as("captureMethod=%s", method)
                    .isInstanceOfSatisfying(
                            BusinessException.class,
                            e -> {
                                assertThat(e.errorCode())
                                        .isEqualTo(CaptureErrorCode.UPLOAD_POLICY_VIOLATION);
                                assertThat(e.details())
                                        .containsExactly(
                                                new ErrorBody.FieldError(
                                                        "captureMethod",
                                                        "allowedCaptureMethods=WEB_RECORDER"));
                            });
        }
        verify(repository, never()).save(any());
    }

    @Test
    void 형식_크기_길이를_어기면_CAP_002와_위반_항목을_주고_저장하지_않는다() {
        UploadRequest request = webRecorder("video/avi", 262_144_001L, 24_999);

        assertThatThrownBy(() -> service.issue(USER_ID, request))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> {
                            assertThat(e.errorCode())
                                    .isEqualTo(CaptureErrorCode.UPLOAD_POLICY_VIOLATION);
                            assertThat(e.details())
                                    .extracting(ErrorBody.FieldError::field)
                                    .containsExactly("contentType", "sizeBytes", "durationMs");
                        });
        verify(repository, never()).save(any());
    }

    @Test
    void 경계값_250MB와_25초_45초는_허용한다() {
        when(repository.save(any(FaceUpload.class))).thenAnswer(inv -> inv.getArgument(0));

        service.issue(USER_ID, webRecorder("video/mp4", 262_144_000L, 25_000));
        service.issue(USER_ID, webRecorder("video/webm", 1L, 45_000));
    }

    @Test
    void 사전_검사가_실패하면_정책을_보기_전에_그_에러를_준다() {
        when(guard.requireReady(USER_ID))
                .thenThrow(new BusinessException(CaptureErrorCode.FACE_DATA_CONSENT_REQUIRED));

        assertThatThrownBy(() -> service.issue(USER_ID, webRecorder("video/avi", 0L, 0)))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e ->
                                assertThat(e.errorCode())
                                        .isEqualTo(CaptureErrorCode.FACE_DATA_CONSENT_REQUIRED));
    }

    @Test
    void 정책_조회는_검증과_같은_설정값을_준다() {
        UploadPolicyResponse policy = service.policy();

        assertThat(policy.video().allowedContentTypes())
                .containsExactly("video/mp4", "video/webm", "video/quicktime");
        assertThat(policy.video().maxSizeBytes()).isEqualTo(262_144_000L);
        assertThat(policy.video().minDurationMs()).isEqualTo(25_000);
        assertThat(policy.video().maxDurationMs()).isEqualTo(45_000);
        assertThat(policy.video().recommendedDurationMs()).isEqualTo(35_000);
        assertThat(policy.uploadUrlTtlSec()).isEqualTo(600);
    }

    private static UploadRequest webRecorder(String contentType, long sizeBytes, int durationMs) {
        return new UploadRequest(
                contentType, sizeBytes, durationMs, CHECKSUM, "WEB_RECORDER", null);
    }
}
