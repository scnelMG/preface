package com.preface.jobmanager.reconstruction.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.deletion.repository.DataDeletionLogRepository;
import com.preface.common.notification.entity.Notification;
import com.preface.common.notification.entity.NotificationType;
import com.preface.common.notification.repository.NotificationRepository;
import com.preface.common.reconstruction.ReconstructionOutputKeys;
import com.preface.common.reconstruction.entity.JobStageStatus;
import com.preface.common.reconstruction.entity.PipelineStage;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionJobStage;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import com.preface.common.reconstruction.repository.ReconstructionJobStageRepository;
import com.preface.jobmanager.notification.service.MattermostReconNotifier;
import com.preface.jobmanager.reconstruction.repository.LeaseFaceUploadRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;

/** lease 회수 규칙(계약 README "상태와 회수 규칙"). DB·Redis는 mock, 시간은 고정. */
class LeaseRecoveryServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-23T03:00:00Z");
    private static final String USER = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    private static final String UPLOAD = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
    private static final String JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40";

    private final ReconstructionJobRepository jobRepository =
            mock(ReconstructionJobRepository.class);
    private final ReconstructionJobStageRepository stageRepository =
            mock(ReconstructionJobStageRepository.class);
    private final LeaseFaceUploadRepository uploadRepository =
            mock(LeaseFaceUploadRepository.class);
    private final NotificationRepository notificationRepository =
            mock(NotificationRepository.class);
    private final DataDeletionLogRepository deletionLogRepository =
            mock(DataDeletionLogRepository.class);
    private final LeaseQueue queue = mock(LeaseQueue.class);
    private final MattermostReconNotifier mattermost = mock(MattermostReconNotifier.class);
    private LeaseRecoveryService service;

    @BeforeEach
    void setUp() {
        service =
                new LeaseRecoveryService(
                        jobRepository,
                        stageRepository,
                        uploadRepository,
                        notificationRepository,
                        deletionLogRepository,
                        queue,
                        new LeaseProperties(null, 0, null, null, null, null, 0, null),
                        mattermost,
                        mock(PlatformTransactionManager.class),
                        Clock.fixed(NOW, ZoneOffset.UTC));
        when(queue.processing()).thenReturn(List.of(JOB));
    }

    @Test
    void lease가_남아_있으면_건드리지_않는다() {
        claim(NOW.minusSeconds(599), 1);

        LeaseRecoveryService.Summary summary = service.recoverExpired();

        assertThat(summary).isEqualTo(new LeaseRecoveryService.Summary(0, 0, 0));
        verify(jobRepository, never()).findByIdForUpdate(anyString());
    }

    @Test
    void 첫_시도의_lease가_끝나면_QUEUED로_돌리고_대기열_뒤에_넣는다() {
        claim(NOW.minusSeconds(600), 1);
        ReconstructionJob job = running();

        LeaseRecoveryService.Summary summary = service.recoverExpired();

        assertThat(summary.requeued()).isEqualTo(1);
        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        verify(queue).requeue(JOB);
        verify(mattermost, never()).reconFailed(anyString());
        verify(notificationRepository, never()).save(any());
        verify(deletionLogRepository, never()).save(any());
    }

    @Test
    void lease가_끝나_회수하면_열린_단계_기록을_실패로_닫는다() {
        claim(NOW.minusSeconds(600), 1);
        running();
        ReconstructionJobStage open =
                ReconstructionJobStage.start(
                        JOB, PipelineStage.RECONSTRUCT, 1, "gpu-1", NOW.minusSeconds(900));
        when(stageRepository.findAllByJobIdAndStatus(JOB, JobStageStatus.RUNNING))
                .thenReturn(List.of(open));

        service.recoverExpired();

        assertThat(open.getStatus()).isEqualTo(JobStageStatus.FAILED);
        assertThat(open.getFinishedAt()).isEqualTo(NOW);
        assertThat(open.getDurationMs()).isEqualTo(900_000);
        assertThat(open.getDetail()).contains("lease expired");
    }

    @Test
    void 두_번째_시도의_lease가_끝나면_TIMEOUT으로_실패시키고_알림과_원본_24시간_보관을_남긴다() {
        claim(NOW.minus(Duration.ofHours(1)), 2);
        ReconstructionJob job = running();

        LeaseRecoveryService.Summary summary = service.recoverExpired();

        assertThat(summary.timedOut()).isEqualTo(1);
        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
        assertThat(job.getFailCodesJson()).isEqualTo("[\"TIMEOUT\"]");
        assertThat(job.getFinishedAt()).isEqualTo(NOW);
        verify(uploadRepository).scheduleRetention(UPLOAD, NOW.plus(Duration.ofHours(24)));
        ArgumentCaptor<Notification> notification = ArgumentCaptor.forClass(Notification.class);
        verify(notificationRepository).save(notification.capture());
        assertThat(notification.getValue().getType()).isEqualTo(NotificationType.RECON_FAILED);
        assertThat(notification.getValue().getTargetId()).isEqualTo(JOB);
        ArgumentCaptor<DataDeletionLog> cleanup = ArgumentCaptor.forClass(DataDeletionLog.class);
        verify(deletionLogRepository, times(20)).save(cleanup.capture());
        List<String> expected = new ArrayList<>(ReconstructionOutputKeys.all(USER, JOB, 1));
        expected.addAll(ReconstructionOutputKeys.all(USER, JOB, 2));
        assertThat(cleanup.getAllValues())
                .extracting(DataDeletionLog::getObjectKey)
                .containsExactlyInAnyOrderElementsOf(expected);
        verify(queue).complete(JOB);
        verify(queue, never()).requeue(anyString());
        verify(mattermost).reconFailed(JOB);
    }

    @Test
    void 메타가_없는_처리_중_작업은_지금부터_lease를_시작한다() {
        when(queue.claim(JOB)).thenReturn(Optional.empty());

        service.recoverExpired();

        verify(queue).startLease(JOB, NOW);
        verify(jobRepository, never()).findByIdForUpdate(anyString());
    }

    @Test
    void 이미_끝난_작업은_처리_중_목록에서만_지운다() {
        claim(NOW.minus(Duration.ofHours(1)), 1);
        ReconstructionJob job = running();
        ReflectionTestUtils.setField(job, "status", ReconstructionStatus.SUCCEEDED);

        LeaseRecoveryService.Summary summary = service.recoverExpired();

        assertThat(summary.cleaned()).isEqualTo(1);
        verify(queue).complete(JOB);
        verify(notificationRepository, never()).save(any());
    }

    @Test
    void DB에_행이_없는_작업은_처리_중_목록에서만_지운다() {
        claim(NOW.minus(Duration.ofHours(1)), 1);
        when(jobRepository.findByIdForUpdate(JOB)).thenReturn(Optional.empty());

        assertThat(service.recoverExpired().cleaned()).isEqualTo(1);
        verify(queue).complete(JOB);
    }

    @Test
    void GPU_대기열에서_20분_넘게_아무도_안_가져가면_TIMEOUT으로_끝내고_대기열에서_지운다() {
        ReconstructionJob job = awaitingGpu(Duration.ofMinutes(21));

        assertThat(service.timeOutUnclaimed()).isEqualTo(1);

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
        assertThat(job.getFailCodesJson()).isEqualTo("[\"TIMEOUT\"]");
        assertThat(job.getFinishedAt()).isEqualTo(NOW);
        verify(jobRepository).findIdsAwaitingGpuSince(NOW.minus(Duration.ofMinutes(20)));
        verify(uploadRepository).scheduleRetention(UPLOAD, NOW.plus(Duration.ofHours(24)));
        ArgumentCaptor<Notification> notification = ArgumentCaptor.forClass(Notification.class);
        verify(notificationRepository).save(notification.capture());
        assertThat(notification.getValue().getType()).isEqualTo(NotificationType.RECON_FAILED);
        verify(queue).removeWaiting(JOB);
        verify(mattermost).reconFailed(JOB);
    }

    @Test
    void 잠그고_보니_워커가_먼저_가져갔으면_건드리지_않는다() {
        ReconstructionJob job = awaitingGpu(Duration.ofMinutes(21));
        job.start(NOW);

        assertThat(service.timeOutUnclaimed()).isZero();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.RUNNING);
        verify(notificationRepository, never()).save(any());
        verify(queue, never()).removeWaiting(anyString());
        verify(mattermost, never()).reconFailed(anyString());
    }

    @Test
    void 잠그고_보니_회수돼_방금_대기열에_다시_들어왔으면_건드리지_않는다() {
        ReconstructionJob job = awaitingGpu(Duration.ofMinutes(21));
        ReflectionTestUtils.setField(job, "updatedAt", NOW.minusSeconds(5));

        assertThat(service.timeOutUnclaimed()).isZero();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        verify(queue, never()).removeWaiting(anyString());
    }

    @Test
    void GPU_워커가_일하고_있으면_밀린_대기_작업은_시간_초과하지_않는다() {
        String busy = "3c1d9e2f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
        when(queue.processing()).thenReturn(List.of(busy));
        when(queue.claim(busy))
                .thenReturn(Optional.of(new LeaseQueue.Claim(NOW.minusSeconds(30), 1)));
        ReconstructionJob job = awaitingGpu(Duration.ofMinutes(25));

        assertThat(service.timeOutUnclaimed()).isZero();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        verify(jobRepository, never()).findIdsAwaitingGpuSince(any());
        verify(queue, never()).removeWaiting(anyString());
    }

    @Test
    void 처리_중_작업이_있어도_lease가_끝났으면_워커가_없는_것으로_보고_시간_초과한다() {
        String stale = "3c1d9e2f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
        when(queue.processing()).thenReturn(List.of(stale));
        when(queue.claim(stale))
                .thenReturn(
                        Optional.of(new LeaseQueue.Claim(NOW.minus(Duration.ofMinutes(11)), 1)));
        ReconstructionJob job = awaitingGpu(Duration.ofMinutes(25));

        assertThat(service.timeOutUnclaimed()).isEqualTo(1);

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
    }

    @Test
    void 추출_워커가_20분_넘게_아무도_안_가져가면_TIMEOUT으로_끝내고_원본_보관과_알림을_남긴다() {
        ReconstructionJob job = awaitingFrames(Duration.ofMinutes(21), null, 0);

        assertThat(service.timeOutExtraction()).isEqualTo(1);

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
        assertThat(job.getFailCodesJson()).isEqualTo("[\"TIMEOUT\"]");
        assertThat(job.getFailDetail()).contains("not claimed for 20 minutes");
        assertThat(job.getFinishedAt()).isEqualTo(NOW);
        verify(jobRepository)
                .findIdsExtractionToTimeOut(
                        NOW.minusSeconds(600), 2, NOW.minus(Duration.ofMinutes(20)));
        verify(uploadRepository).scheduleRetention(UPLOAD, NOW.plus(Duration.ofHours(24)));
        ArgumentCaptor<Notification> notification = ArgumentCaptor.forClass(Notification.class);
        verify(notificationRepository).save(notification.capture());
        assertThat(notification.getValue().getType()).isEqualTo(NotificationType.RECON_FAILED);
        assertThat(notification.getValue().getTargetId()).isEqualTo(JOB);
        // 한 번도 가져가지 않아 올린 묶음이 없다
        verify(deletionLogRepository, never()).save(any());
        verify(mattermost).reconFailed(JOB);
    }

    @Test
    void 추출_시도를_다_쓰고_lease가_끝나면_다음_claim을_기다리지_않고_끝내며_시도별_묶음_삭제를_예약한다() {
        ReconstructionJob job = awaitingFrames(Duration.ofMinutes(11), NOW.minusSeconds(601), 2);

        assertThat(service.timeOutExtraction()).isEqualTo(1);

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
        assertThat(job.getFailDetail()).contains("after 2 attempts");
        ArgumentCaptor<DataDeletionLog> cleanup = ArgumentCaptor.forClass(DataDeletionLog.class);
        verify(deletionLogRepository, times(2)).save(cleanup.capture());
        assertThat(cleanup.getAllValues())
                .extracting(DataDeletionLog::getObjectKey)
                .containsExactlyInAnyOrder(
                        ReconstructionOutputKeys.framesBundle(USER, UPLOAD, 1),
                        ReconstructionOutputKeys.framesBundle(USER, UPLOAD, 2));
        assertThat(cleanup.getAllValues())
                .extracting(DataDeletionLog::getTargetType)
                .containsOnly(DataDeletionLog.TARGET_FACE_UPLOAD_FRAMES);
        verify(mattermost).reconFailed(JOB);
    }

    @Test
    void 잠그고_보니_추출_워커가_방금_가져갔으면_건드리지_않는다() {
        ReconstructionJob job = awaitingFrames(Duration.ofMinutes(21), NOW.minusSeconds(5), 2);

        assertThat(service.timeOutExtraction()).isZero();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        verify(notificationRepository, never()).save(any());
        verify(mattermost, never()).reconFailed(anyString());
    }

    @Test
    void 첫_시도의_lease가_끝났어도_20분이_안_됐으면_다음_추출_워커를_기다린다() {
        ReconstructionJob job = awaitingFrames(Duration.ofMinutes(11), NOW.minusSeconds(660), 1);

        assertThat(service.timeOutExtraction()).isZero();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        verify(uploadRepository, never()).scheduleRetention(anyString(), any());
    }

    @Test
    void 잠그고_보니_프레임이_준비됐으면_추출_시간_초과로_끝내지_않는다() {
        ReconstructionJob job = awaitingFrames(Duration.ofMinutes(21), null, 0);
        job.framesReady(NOW);

        assertThat(service.timeOutExtraction()).isZero();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        verify(mattermost, never()).reconFailed(anyString());
    }

    @Test
    void GPU_대기인데_대기열과_처리_중_목록_어디에도_없으면_다시_넣는다() {
        String waiting = "3c1d9e2f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
        String working = "4d2e0f3a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";
        when(jobRepository.findIdsAwaitingGpuSince(any()))
                .thenReturn(List.of(JOB, waiting, working));
        when(queue.waiting()).thenReturn(List.of(waiting));
        when(queue.processing()).thenReturn(List.of(working));

        assertThat(service.restoreGpuQueue()).isEqualTo(1);

        verify(jobRepository).findIdsAwaitingGpuSince(NOW.minus(Duration.ofMinutes(2)));
        verify(queue).enqueue(JOB);
        verify(queue, never()).enqueue(waiting);
        verify(queue, never()).enqueue(working);
    }

    @Test
    void GPU_대기_작업이_없으면_대기열을_읽지_않는다() {
        when(jobRepository.findIdsAwaitingGpuSince(any())).thenReturn(List.of());

        assertThat(service.restoreGpuQueue()).isZero();

        verify(queue, never()).waiting();
        verify(queue, never()).enqueue(anyString());
    }

    private void claim(Instant lastSeenAt, int attempts) {
        when(queue.claim(JOB)).thenReturn(Optional.of(new LeaseQueue.Claim(lastSeenAt, attempts)));
    }

    private ReconstructionJob running() {
        ReconstructionJob job = ReconstructionJob.queue(USER, UPLOAD);
        ReflectionTestUtils.setField(job, "id", JOB);
        job.start(NOW.minus(Duration.ofHours(2)));
        when(jobRepository.findByIdForUpdate(JOB)).thenReturn(Optional.of(job));
        return job;
    }

    /** 프레임이 준비돼 GPU 대기열에 {@code waited}만큼 있었던 작업(대기 시작 = updated_at). */
    private ReconstructionJob awaitingGpu(Duration waited) {
        ReconstructionJob job = ReconstructionJob.queue(USER, UPLOAD);
        ReflectionTestUtils.setField(job, "id", JOB);
        job.framesReady(NOW.minus(waited));
        ReflectionTestUtils.setField(job, "updatedAt", NOW.minus(waited));
        when(jobRepository.findIdsAwaitingGpuSince(any())).thenReturn(List.of(JOB));
        when(jobRepository.findByIdForUpdate(JOB)).thenReturn(Optional.of(job));
        return job;
    }

    /**
     * 추출 대기 작업. 마지막 변경(접수·마지막 claim)이 {@code idle} 전이고, 마지막 claim 시각과 시도 수를 준다(claim이 없으면 null·0).
     */
    private ReconstructionJob awaitingFrames(Duration idle, Instant claimedAt, int attempts) {
        ReconstructionJob job = ReconstructionJob.queue(USER, UPLOAD);
        ReflectionTestUtils.setField(job, "id", JOB);
        ReflectionTestUtils.setField(job, "updatedAt", NOW.minus(idle));
        ReflectionTestUtils.setField(job, "extractClaimedAt", claimedAt);
        ReflectionTestUtils.setField(job, "extractAttempts", attempts);
        when(jobRepository.findIdsExtractionToTimeOut(any(), any(Integer.class), any()))
                .thenReturn(List.of(JOB));
        when(jobRepository.findByIdForUpdate(JOB)).thenReturn(Optional.of(job));
        return job;
    }
}
