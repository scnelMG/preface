package com.preface.api.reconstruction.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.notification.service.NotificationService;
import com.preface.api.reconstruction.dto.ExtractionResultRequest;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.deletion.repository.DataDeletionLogRepository;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.json.JsonMapper;

/** INT-EXT-03 실패 보고: 일시적인 오류는 남은 시도로 다시 추출한다(S15P31B204-594). DB는 mock. */
class FrameExtractionServiceTest {

    private static final String JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40";
    private static final Instant T0 = Instant.parse("2026-11-10T03:30:00Z");

    private final ReconstructionJobRepository jobRepository =
            mock(ReconstructionJobRepository.class);
    private final FaceUploadGateway faceUploadGateway = mock(FaceUploadGateway.class);
    private final DataDeletionLogRepository deletionLogRepository =
            mock(DataDeletionLogRepository.class);
    private final NotificationService notificationService = mock(NotificationService.class);
    private final ReconstructionStageRecorder stageRecorder =
            mock(ReconstructionStageRecorder.class);

    @SuppressWarnings("unchecked")
    private final FrameExtractionService service =
            new FrameExtractionService(
                    jobRepository,
                    faceUploadGateway,
                    deletionLogRepository,
                    notificationService,
                    mock(ReconstructionQueue.class),
                    mock(ObjectProvider.class),
                    new JsonColumns(JsonMapper.builder().build()),
                    // extractMaxAttempts 0 → 기본 2
                    new ReconstructionProperties(null, null, null, null, 0, null, null, 0, null, 0),
                    stageRecorder,
                    mock(PlatformTransactionManager.class),
                    Clock.fixed(T0.plusSeconds(30), ZoneOffset.UTC));

    private ReconstructionJob claimedBy(String worker, int attempts) {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        ReflectionTestUtils.setField(job, "id", JOB);
        for (int i = 0; i < attempts; i++) {
            job.claimExtraction(worker, T0);
        }
        when(jobRepository.findByIdForUpdate(JOB)).thenReturn(Optional.of(job));
        return job;
    }

    private static ExtractionResultRequest failed(int attempt, String... codes) {
        return new ExtractionResultRequest(
                attempt,
                "FAILED",
                null,
                null,
                null,
                List.of(codes),
                "video download failed: ConnectError");
    }

    @Test
    void 첫_시도의_INTERNAL_실패는_lease를_풀어_다시_추출한다() {
        ReconstructionJob job = claimedBy("ex-1", 1);

        assertThat(service.result(JOB, "ex-1", failed(1, "INTERNAL"))).isTrue();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        assertThat(job.awaitingFrames()).isTrue();
        assertThat(job.getExtractClaimedAt()).isNull();
        assertThat(job.getExtractAttempts()).isEqualTo(1);
        verify(stageRecorder).failOpen(eq(JOB), anyString());
        verify(notificationService, never()).reconFailed(any(), any());
        verify(faceUploadGateway, never()).recordResult(any(), any(), any());
        // 이 시도가 올렸을 수 있는 묶음만 지운다(원본 영상은 남긴다)
        ArgumentCaptor<DataDeletionLog> deleted = ArgumentCaptor.forClass(DataDeletionLog.class);
        verify(deletionLogRepository).save(deleted.capture());
        assertThat(deleted.getValue().getTargetType())
                .isEqualTo(DataDeletionLog.TARGET_FACE_UPLOAD_FRAMES);
    }

    @Test
    void 마지막_시도의_INTERNAL_실패는_최종_실패다() {
        ReconstructionJob job = claimedBy("ex-1", 2);

        assertThat(service.result(JOB, "ex-1", failed(2, "INTERNAL"))).isTrue();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
        verify(notificationService).reconFailed("u", JOB);
    }

    @Test
    void 영상_문제는_시도가_남아도_바로_실패한다() {
        ReconstructionJob job = claimedBy("ex-1", 1);

        service.result(JOB, "ex-1", failed(1, "QUALITY_ANGLE"));

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
    }

    @Test
    void INTERNAL과_다른_코드가_섞이면_다시_하지_않는다() {
        ReconstructionJob job = claimedBy("ex-1", 1);

        service.result(JOB, "ex-1", failed(1, "INTERNAL", "TIMEOUT"));

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
    }
}
