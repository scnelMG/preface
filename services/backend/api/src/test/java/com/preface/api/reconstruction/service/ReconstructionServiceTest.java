package com.preface.api.reconstruction.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.capture.service.CaptureLinkService;
import com.preface.api.reconstruction.dto.CreateReconstructionResponse;
import com.preface.api.reconstruction.dto.ReconstructionStatusResponse;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionStage;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.json.JsonMapper;

/** 사용자 상태 API의 대기 여부·대기 시작 시각·대기열 순번(S15P31B204-729). SQL은 mock. */
class ReconstructionServiceTest {

    private static final Instant NOW = Instant.parse("2026-11-10T03:00:00Z");
    private static final String USER = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    private static final String JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40";
    private static final String UPLOAD = "5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

    /** 기본값: 추출 lease 600초. */
    private static final ReconstructionProperties PROPERTIES =
            new ReconstructionProperties(null, null, null, null, 0, null, null, 0, null, 0);

    private static final Instant STALE_BEFORE = NOW.minus(PROPERTIES.extractLeaseTimeout());

    private final ReconstructionJobRepository jobRepository =
            mock(ReconstructionJobRepository.class);
    private final FaceUploadGateway faceUploadGateway = mock(FaceUploadGateway.class);

    @SuppressWarnings("unchecked")
    private final ReconstructionService service =
            new ReconstructionService(
                    jobRepository,
                    mock(FaceModelRepository.class),
                    faceUploadGateway,
                    mock(ObjectProvider.class),
                    new JsonColumns(JsonMapper.builder().build()),
                    PROPERTIES,
                    mock(CaptureLinkService.class),
                    Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void 아무도_가져가지_않은_작업은_1단계_추출_대기이고_접수_시각부터_추출_대기열_순번을_준다() {
        ReconstructionJob job = job(NOW.minusSeconds(90), NOW.minusSeconds(90));
        when(jobRepository.extractQueuePosition(JOB, STALE_BEFORE)).thenReturn(3L);

        ReconstructionStatusResponse status = get(job);

        assertThat(status.status()).isEqualTo("QUEUED");
        assertThat(status.stage()).isNull();
        assertThat(status.stageIndex()).isNull();
        assertThat(status.waiting()).isTrue();
        assertThat(status.waitingSince()).isEqualTo(NOW.minusSeconds(90));
        assertThat(status.queuePosition()).isEqualTo(3L);
        verify(jobRepository, never()).gpuQueuePosition(anyString());
    }

    @Test
    void 추출_lease가_살아_있으면_추출_중이라_기다리지_않고_순번이_없다() {
        ReconstructionJob job = job(NOW.minusSeconds(90), NOW.minusSeconds(30));
        job.claimExtraction("extract-1", NOW.minusSeconds(30));

        ReconstructionStatusResponse status = get(job);

        assertThat(status.stage()).isEqualTo("FRAME_SELECT");
        assertThat(status.stageIndex()).isEqualTo(1);
        assertThat(status.waiting()).isFalse();
        assertThat(status.waitingSince()).isNull();
        assertThat(status.queuePosition()).isNull();
        verify(jobRepository, never()).extractQueuePosition(anyString(), any());
    }

    @Test
    void 추출_lease가_끝나면_다시_1단계_추출_대기이고_lease가_끝난_시각부터_센다() {
        Instant claimedAt = NOW.minus(Duration.ofMinutes(11));
        ReconstructionJob job = job(NOW.minus(Duration.ofMinutes(12)), claimedAt);
        job.claimExtraction("extract-1", claimedAt);
        when(jobRepository.extractQueuePosition(JOB, STALE_BEFORE)).thenReturn(1L);

        ReconstructionStatusResponse status = get(job);

        assertThat(status.stage()).isEqualTo("FRAME_SELECT");
        assertThat(status.waiting()).isTrue();
        assertThat(status.waitingSince()).isEqualTo(claimedAt.plus(Duration.ofMinutes(10)));
        assertThat(status.queuePosition()).isEqualTo(1L);
    }

    @Test
    void lease가_딱_끝나는_시각에는_아직_추출_중이다() {
        ReconstructionJob job = job(NOW.minus(Duration.ofMinutes(12)), STALE_BEFORE);
        job.claimExtraction("extract-1", STALE_BEFORE);

        assertThat(get(job).waiting()).isFalse();
    }

    @Test
    void 프레임이_준비되면_2단계_GPU_대기이고_GPU_대기열에_들어온_시각부터_GPU_순번을_준다() {
        Instant readyAt = NOW.minusSeconds(40);
        ReconstructionJob job = job(NOW.minusSeconds(200), readyAt);
        job.claimExtraction("extract-1", NOW.minusSeconds(150));
        job.framesReady(readyAt);
        when(jobRepository.gpuQueuePosition(JOB)).thenReturn(2L);

        ReconstructionStatusResponse status = get(job);

        assertThat(status.stage()).isEqualTo("QUALITY_CHECK");
        assertThat(status.stageIndex()).isEqualTo(2);
        assertThat(status.waiting()).isTrue();
        assertThat(status.waitingSince()).isEqualTo(readyAt);
        assertThat(status.queuePosition()).isEqualTo(2L);
        verify(jobRepository, never()).extractQueuePosition(anyString(), any());
    }

    @Test
    void 실행_중이면_기다리지_않고_순번이_없다() {
        ReconstructionJob job = job(NOW.minusSeconds(200), NOW.minusSeconds(10));
        job.claimExtraction("extract-1", NOW.minusSeconds(150));
        job.framesReady(NOW.minusSeconds(40));
        job.start(NOW.minusSeconds(10));
        job.progress(ReconstructionStage.RECONSTRUCT, "VGGT");

        ReconstructionStatusResponse status = get(job);

        assertThat(status.status()).isEqualTo("RUNNING");
        assertThat(status.waiting()).isFalse();
        assertThat(status.waitingSince()).isNull();
        assertThat(status.queuePosition()).isNull();
    }

    @Test
    void 끝난_작업은_기다리지_않고_순번이_없다() {
        ReconstructionJob job = job(NOW.minusSeconds(200), NOW);
        job.claimExtraction("extract-1", NOW.minusSeconds(150));
        job.framesReady(NOW.minusSeconds(40));
        job.start(NOW.minusSeconds(30));
        job.fail(NOW, "[\"FIT_FAILED\"]", "fit", 30_000, null);

        ReconstructionStatusResponse status = get(job);

        assertThat(status.status()).isEqualTo("FAILED");
        assertThat(status.waiting()).isFalse();
        assertThat(status.waitingSince()).isNull();
        assertThat(status.queuePosition()).isNull();
    }

    @Test
    void 순번_쿼리가_0을_주어도_기다리는_작업은_1번째_밑으로_내려가지_않는다() {
        ReconstructionJob job = job(NOW.minusSeconds(90), NOW.minusSeconds(90));
        when(jobRepository.extractQueuePosition(JOB, STALE_BEFORE)).thenReturn(0L);

        assertThat(get(job).queuePosition()).isEqualTo(1L);
    }

    @Test
    void 같은_업로드로_다시_만들면_생성_응답에도_대기_여부와_순번이_있다() {
        ReconstructionJob job = job(NOW.minusSeconds(5), NOW.minusSeconds(5));
        FaceUploadGateway.UploadRow upload = mock(FaceUploadGateway.UploadRow.class);
        when(upload.userId()).thenReturn(USER);
        when(faceUploadGateway.lockUser(USER)).thenReturn(true);
        when(faceUploadGateway.find(UPLOAD)).thenReturn(Optional.of(upload));
        when(jobRepository.findByFaceUploadId(UPLOAD)).thenReturn(Optional.of(job));
        when(jobRepository.extractQueuePosition(JOB, STALE_BEFORE)).thenReturn(4L);

        CreateReconstructionResponse created = service.create(Requester.user(USER), UPLOAD).body();

        assertThat(created.waiting()).isTrue();
        assertThat(created.waitingSince()).isEqualTo(NOW.minusSeconds(5));
        assertThat(created.queuePosition()).isEqualTo(4L);
        assertThat(created.pollIntervalMs()).isEqualTo(3000);
    }

    private ReconstructionStatusResponse get(ReconstructionJob job) {
        when(jobRepository.findByIdAndUserId(JOB, USER)).thenReturn(Optional.of(job));
        return service.get(Requester.user(USER), JOB);
    }

    private static ReconstructionJob job(Instant createdAt, Instant updatedAt) {
        ReconstructionJob job = ReconstructionJob.queue(USER, UPLOAD);
        ReflectionTestUtils.setField(job, "id", JOB);
        ReflectionTestUtils.setField(job, "createdAt", createdAt);
        ReflectionTestUtils.setField(job, "updatedAt", updatedAt);
        return job;
    }
}
