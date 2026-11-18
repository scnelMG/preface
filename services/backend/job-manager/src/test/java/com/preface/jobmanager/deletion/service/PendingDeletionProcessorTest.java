package com.preface.jobmanager.deletion.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.common.capture.entity.FaceUploadStatus;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.jobmanager.deletion.repository.DeletionFaceUploadRepository;
import com.preface.jobmanager.deletion.repository.DeletionLogRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;

/** PENDING 삭제 기록 처리 규칙(DONE·재시도·FAILED). DB·S3는 mock, 시간은 고정. */
class PendingDeletionProcessorTest {

    private static final Instant NOW = Instant.parse("2026-10-23T03:00:00Z");
    private static final String USER = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    private static final String UPLOAD = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
    private static final String KEY = "users/" + USER + "/uploads/" + UPLOAD + ".mp4";

    private final DeletionLogRepository logRepository = mock(DeletionLogRepository.class);
    private final DeletionFaceUploadRepository uploadRepository =
            mock(DeletionFaceUploadRepository.class);
    private final DeletionStorage storage = mock(DeletionStorage.class);
    private PendingDeletionProcessor processor;

    @BeforeEach
    void setUp() {
        processor =
                new PendingDeletionProcessor(
                        logRepository,
                        uploadRepository,
                        storage,
                        new DeletionProperties(null, null, 10, 3, null, null, null),
                        mock(PlatformTransactionManager.class),
                        Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void S3_삭제에_성공하면_DONE으로_바꾸고_원본_영상이면_업로드도_DELETED로_바꾼다() {
        DataDeletionLog row = row("log-1", "FACE_UPLOAD", UPLOAD, KEY, 0);
        pending(row);

        PendingDeletionProcessor.Result result = processor.processBatch(new HashSet<>());

        assertThat(result).isEqualTo(new PendingDeletionProcessor.Result(1, 0, 0));
        verify(storage).delete(KEY);
        verify(logRepository).markDone("log-1", NOW, "DONE", "PENDING");
        verify(uploadRepository).markDeleted(UPLOAD, FaceUploadStatus.DELETED, NOW);
    }

    @Test
    void object_key가_없는_기록은_S3를_부르지_않고_DONE으로_바꾼다() {
        pending(row("log-1", "SIMULATION", "sim-1", null, 0));

        processor.processBatch(new HashSet<>());

        verify(storage, never()).delete(anyString());
        verify(logRepository).markDone("log-1", NOW, "DONE", "PENDING");
        verify(uploadRepository, never()).markDeleted(anyString(), any(), any());
    }

    @Test
    void S3_삭제가_실패하면_재시도_횟수를_올리고_PENDING으로_남긴다() {
        pending(row("log-1", "FACE_MODEL", "model-1", KEY, 0));
        doThrow(new RuntimeException("synthetic")).when(storage).delete(KEY);

        PendingDeletionProcessor.Result result = processor.processBatch(new HashSet<>());

        assertThat(result).isEqualTo(new PendingDeletionProcessor.Result(0, 1, 0));
        verify(logRepository).recordFailure("log-1", 1, "PENDING", "PENDING");
        verify(logRepository, never()).markDone(anyString(), any(), anyString(), anyString());
    }

    @Test
    void 재시도_한도에_닿으면_FAILED로_바꾼다() {
        pending(row("log-1", "FACE_MODEL", "model-1", KEY, 2));
        doThrow(new RuntimeException("synthetic")).when(storage).delete(KEY);

        PendingDeletionProcessor.Result result = processor.processBatch(new HashSet<>());

        assertThat(result).isEqualTo(new PendingDeletionProcessor.Result(0, 0, 1));
        verify(logRepository).recordFailure("log-1", 3, "FAILED", "PENDING");
    }

    @Test
    void 같은_실행에서_이미_시도한_기록은_다시_시도하지_않는다() {
        pending(row("log-1", "FACE_MODEL", "model-1", KEY, 1));
        Set<String> attempted = new HashSet<>(List.of("log-1"));

        PendingDeletionProcessor.Result result = processor.processBatch(attempted);

        assertThat(result.total()).isZero();
        verify(storage, never()).delete(anyString());
        verify(logRepository, never())
                .recordFailure(anyString(), anyInt(), anyString(), eq("PENDING"));
    }

    private void pending(DataDeletionLog... rows) {
        when(logRepository.findEligible(
                        eq("PENDING"),
                        eq("RECON_OUTPUT"),
                        eq(NOW.minus(Duration.ofHours(1))),
                        any(Pageable.class)))
                .thenReturn(List.of(rows));
    }

    private static DataDeletionLog row(
            String id, String targetType, String targetId, String objectKey, int retryCount) {
        DataDeletionLog log =
                DataDeletionLog.pending(USER, targetType, targetId, objectKey, "RETENTION_POLICY");
        ReflectionTestUtils.setField(log, "id", id);
        ReflectionTestUtils.setField(log, "retryCount", retryCount);
        return log;
    }
}
