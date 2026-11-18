package com.preface.api.facereading.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.repository.FaceUploadRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.FaceReadingErrorCode;
import com.preface.common.facereading.entity.FaceReading;
import com.preface.common.facereading.entity.FaceReadingStatus;
import com.preface.common.facereading.repository.FaceReadingRepository;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.json.JsonMapper;

/** 관상 요청 규칙: 본인 작업만, 추출 뒤에만, 3D 1개당 1건(있으면 다시 부르지 않음), 실패는 묶음이 있을 때만 다시. */
class FaceReadingServiceTest {

    private static final String USER = "u-1";
    private static final String JOB = "job-1";
    private static final Instant NOW = Instant.parse("2026-10-29T05:00:00Z");

    private final ReconstructionJobRepository jobs = mock(ReconstructionJobRepository.class);
    private final FaceUploadRepository uploads = mock(FaceUploadRepository.class);
    private final FaceReadingRepository readings = mock(FaceReadingRepository.class);
    private final FaceReadingWorker worker = mock(FaceReadingWorker.class);
    private final FrontFrameSource frames = mock(FrontFrameSource.class);
    private final ReconstructionJob job = mock(ReconstructionJob.class);
    private final FaceUpload upload = mock(FaceUpload.class);
    private FaceReadingService service;

    @BeforeEach
    void setUp() {
        service =
                new FaceReadingService(
                        jobs,
                        uploads,
                        readings,
                        worker,
                        frames,
                        new FaceReadingProperties(null, null, null),
                        JsonMapper.builder().build(),
                        Clock.fixed(NOW, ZoneOffset.UTC));
        when(jobs.findByIdAndUserId(JOB, USER)).thenReturn(Optional.of(job));
        when(job.getFaceUploadId()).thenReturn("up-1");
        when(job.getFramesReadyAt()).thenReturn(NOW.minusSeconds(30));
        when(uploads.findById("up-1")).thenReturn(Optional.of(upload));
        when(upload.getFramesObjectKey()).thenReturn("users/u-1/uploads/up-1/frames-a1.tar");
        when(readings.findByReconstructionJobId(JOB)).thenReturn(Optional.empty());
        when(readings.saveAndFlush(any(FaceReading.class)))
                .thenAnswer(
                        inv -> {
                            FaceReading r = inv.getArgument(0);
                            if (r.getId() == null) ReflectionTestUtils.setField(r, "id", "r-1");
                            return r;
                        });
    }

    @Test
    void 처음_요청하면_PENDING을_만들고_묶음_key로_작업을_넣는다() {
        var response = service.request(USER, JOB);

        assertThat(response.status()).isEqualTo("PENDING");
        assertThat(response.readingId()).isEqualTo("r-1");
        // 트랜잭션 밖(단위 테스트)이라 바로 넣는다. 실제로는 커밋 뒤에 넣는다
        verify(worker).submit("r-1", "users/u-1/uploads/up-1/frames-a1.tar");
    }

    @Test
    void 남의_작업이면_존재를_숨기고_COMMON_002다() {
        assertThatThrownBy(() -> service.request("other", JOB))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(CommonErrorCode.NOT_FOUND);
    }

    @Test
    void 추출_전이면_READ_001이고_묶음이_지워졌으면_READ_002다() {
        when(job.getFramesReadyAt()).thenReturn(null);
        assertCode(FaceReadingErrorCode.PHOTO_NOT_READY);

        when(job.getFramesReadyAt()).thenReturn(NOW);
        when(upload.getFramesObjectKey()).thenReturn(null);
        assertCode(FaceReadingErrorCode.PHOTO_GONE);
        verify(worker, never()).submit(anyString(), anyString());
    }

    @Test
    void 이미_DONE이거나_진행_중이면_GMS를_다시_부르지_않고_그대로_준다() {
        FaceReading done = reading(FaceReadingStatus.DONE, NOW.minusSeconds(60));
        ReflectionTestUtils.setField(done, "result", "{\"title\":\"t\"}");
        when(readings.findByReconstructionJobId(JOB)).thenReturn(Optional.of(done));
        assertThat(service.request(USER, JOB).result().path("title").asText()).isEqualTo("t");

        when(readings.findByReconstructionJobId(JOB))
                .thenReturn(Optional.of(reading(FaceReadingStatus.PENDING, NOW.minusSeconds(60))));
        assertThat(service.request(USER, JOB).status()).isEqualTo("PENDING");

        verify(worker, never()).submit(anyString(), anyString());
    }

    @Test
    void 실패했거나_5분_넘게_멈춘_요청은_같은_행으로_다시_시작한다() {
        FaceReading failed = reading(FaceReadingStatus.FAILED, NOW.minusSeconds(60));
        when(readings.findByReconstructionJobId(JOB)).thenReturn(Optional.of(failed));
        assertThat(service.request(USER, JOB).status()).isEqualTo("PENDING");

        FaceReading stalled = reading(FaceReadingStatus.PENDING, NOW.minusSeconds(600));
        when(readings.findByReconstructionJobId(JOB)).thenReturn(Optional.of(stalled));
        assertThat(service.request(USER, JOB).status()).isEqualTo("PENDING");

        verify(worker, org.mockito.Mockito.times(2))
                .submit("r-old", "users/u-1/uploads/up-1/frames-a1.tar");
    }

    private void assertCode(FaceReadingErrorCode code) {
        assertThatThrownBy(() -> service.request(USER, JOB))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(code);
    }

    private static FaceReading reading(FaceReadingStatus status, Instant updatedAt) {
        FaceReading reading = FaceReading.pending(USER, JOB);
        ReflectionTestUtils.setField(reading, "id", "r-old");
        ReflectionTestUtils.setField(reading, "status", status);
        ReflectionTestUtils.setField(reading, "updatedAt", updatedAt);
        return reading;
    }

    @Test
    void 관상_사진은_관상을_요청한_작업에서_묶음의_정면을_준다() {
        when(readings.findByReconstructionJobId(JOB))
                .thenReturn(Optional.of(FaceReading.pending(USER, JOB)));
        when(frames.frontJpeg("users/u-1/uploads/up-1/frames-a1.tar"))
                .thenReturn(new byte[] {1, 2});

        assertThat(service.photo(USER, JOB)).containsExactly(1, 2);
    }

    @Test
    void 관상을_요청한_적_없거나_남의_작업이면_사진도_COMMON_002다() {
        assertThatThrownBy(() -> service.photo(USER, JOB))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(CommonErrorCode.NOT_FOUND);
        assertThatThrownBy(() -> service.photo("other", JOB))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(CommonErrorCode.NOT_FOUND);
        verify(frames, never()).frontJpeg(anyString());
    }

    @Test
    void 묶음이_그새_지워졌으면_사진은_READ_002다() {
        when(readings.findByReconstructionJobId(JOB))
                .thenReturn(Optional.of(FaceReading.pending(USER, JOB)));
        when(frames.frontJpeg(anyString()))
                .thenThrow(new FaceReadingFailure(FaceReadingFailure.PHOTO_GONE, "test"));

        assertThatThrownBy(() -> service.photo(USER, JOB))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(FaceReadingErrorCode.PHOTO_GONE);
    }
}
