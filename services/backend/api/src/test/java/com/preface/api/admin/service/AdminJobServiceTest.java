package com.preface.api.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.admin.dto.AdminJobDetailResponse;
import com.preface.api.admin.dto.AdminJobListItem;
import com.preface.api.admin.dto.AdminJobQueueResponse;
import com.preface.api.admin.dto.AdminJobSummaryResponse;
import com.preface.api.admin.dto.AdminPage;
import com.preface.api.reconstruction.service.ReconstructionProperties;
import com.preface.common.admin.entity.AdminAccessTargetType;
import com.preface.common.error.BusinessException;
import com.preface.common.error.ErrorCode;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.reconstruction.entity.PipelineStage;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionJobStage;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import com.preface.common.reconstruction.repository.ReconstructionJobStageRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.json.JsonMapper;

/** 관리자 작업 화면 규칙(S15P31B204-652). SQL은 mock. */
class AdminJobServiceTest {

    // 2026-11-07 12:00 KST
    private static final Instant NOW = Instant.parse("2026-11-07T03:00:00Z");
    private static final String ADMIN = "a0000000-0000-4000-8000-000000000001";
    private static final String USER = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    private static final String JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40";

    private final AdminJobQueries queries = mock(AdminJobQueries.class);
    private final ReconstructionJobRepository jobRepository =
            mock(ReconstructionJobRepository.class);
    private final ReconstructionJobStageRepository stageRepository =
            mock(ReconstructionJobStageRepository.class);
    private final FaceModelRepository faceModelRepository = mock(FaceModelRepository.class);
    private final AdminAccessLogger accessLogger = mock(AdminAccessLogger.class);
    private final AdminJobService service =
            new AdminJobService(
                    queries,
                    jobRepository,
                    stageRepository,
                    faceModelRepository,
                    accessLogger,
                    new AdminJobProperties(null, null),
                    new ReconstructionProperties(null, null, null, null, 0, null, null, 0, null, 0),
                    JsonMapper.builder().build(),
                    Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void 오늘은_한국_시간_0시부터이고_7일_30일은_지금부터_거꾸로_센다() {
        assertThat(AdminJobService.periodStart("today", NOW))
                .isEqualTo(Instant.parse("2026-11-06T15:00:00Z"));
        assertThat(AdminJobService.periodStart("7d", NOW)).isEqualTo(NOW.minus(Duration.ofDays(7)));
        assertThat(AdminJobService.periodStart("30d", NOW))
                .isEqualTo(NOW.minus(Duration.ofDays(30)));
        assertCode(() -> AdminJobService.periodStart("1y", NOW), "COMMON_001");
    }

    @Test
    void 요약은_실제_상태_이름으로_세고_실패율_실패_코드_처리_시간_멈춤을_낸다() {
        Instant from = NOW.minus(Duration.ofDays(7));
        when(queries.countByStatus(from, NOW))
                .thenReturn(
                        List.of(
                                new AdminJobQueries.StatusCount("SUCCEEDED", 8),
                                new AdminJobQueries.StatusCount("FAILED", 1),
                                new AdminJobQueries.StatusCount("RUNNING", 2)));
        when(queries.failCodesJson(from, NOW))
                .thenReturn(
                        List.of("[\"QUALITY_ANGLE\",\"QUALITY_LIGHT\"]", "[\"QUALITY_ANGLE\"]"));
        when(queries.succeededDurations(from, NOW)).thenReturn(List.of(100_000L, 300_000L));
        when(queries.countStuck(NOW.minus(Duration.ofMinutes(15)))).thenReturn(1L);

        AdminJobSummaryResponse summary = service.summary("7d");

        assertThat(summary.counts())
                .containsExactly(
                        java.util.Map.entry("QUEUED", 0L),
                        java.util.Map.entry("RUNNING", 2L),
                        java.util.Map.entry("SUCCEEDED", 8L),
                        java.util.Map.entry("FAILED", 1L),
                        java.util.Map.entry("CANCELED", 0L));
        assertThat(summary.total()).isEqualTo(11);
        assertThat(summary.failureRate()).isEqualTo(0.111);
        assertThat(summary.failCodes())
                .containsExactly(
                        new AdminJobSummaryResponse.FailCodeCount("QUALITY_ANGLE", 2),
                        new AdminJobSummaryResponse.FailCodeCount("QUALITY_LIGHT", 1));
        assertThat(summary.durationMs())
                .isEqualTo(new AdminJobSummaryResponse.Duration(200_000L, 300_000L, 300_000L));
        assertThat(summary.stuckCount()).isEqualTo(1);
        assertThat(summary.stuckThresholdMinutes()).isEqualTo(15);
        assertThat(summary.from()).isEqualTo(from);
        assertThat(summary.to()).isEqualTo(NOW);
    }

    @Test
    void 끝난_작업이_없으면_실패율과_처리_시간은_null이다() {
        AdminJobSummaryResponse summary = service.summary("today");

        assertThat(summary.failureRate()).isNull();
        assertThat(summary.durationMs().avg()).isNull();
        assertThat(summary.durationMs().p95()).isNull();
        assertThat(summary.total()).isZero();
    }

    @Test
    void 목록은_크기를_100으로_자르고_회원_조건이_있을_때만_조회_기록을_남긴다() {
        when(queries.count(any())).thenReturn(250L);
        when(queries.list(any(), anyInt(), anyInt()))
                .thenReturn(
                        List.of(
                                new AdminJobQueries.ListRow(
                                        JOB,
                                        USER,
                                        "FAILED",
                                        "RECONSTRUCT",
                                        "[\"FIT_FAILED\"]",
                                        1000,
                                        NOW,
                                        NOW,
                                        "FILE",
                                        "SM-S918N")));

        AdminPage<AdminJobListItem> page =
                service.list(
                        ADMIN,
                        new AdminJobService.ListQuery(
                                "FAILED",
                                "FIT_FAILED",
                                null,
                                null,
                                "2026-11-01T15:00:00Z",
                                "2026-11-07T15:00:00Z",
                                1,
                                500),
                        "/api/v1/admin/reconstructions");

        assertThat(page.size()).isEqualTo(100);
        assertThat(page.page()).isEqualTo(1);
        assertThat(page.totalPages()).isEqualTo(3);
        assertThat(page.items().getFirst().failCodes()).containsExactly("FIT_FAILED");
        ArgumentCaptor<AdminJobQueries.Filter> filter =
                ArgumentCaptor.forClass(AdminJobQueries.Filter.class);
        verify(queries).list(filter.capture(), eq(1), eq(100));
        assertThat(filter.getValue().from()).isEqualTo(Instant.parse("2026-11-01T15:00:00Z"));
        assertThat(filter.getValue().to()).isEqualTo(Instant.parse("2026-11-07T15:00:00Z"));
        verify(accessLogger, never()).record(any(), any(), any(), any(), any());

        service.list(
                ADMIN,
                new AdminJobService.ListQuery(null, null, null, USER, null, null, null, null),
                "/api/v1/admin/reconstructions");
        verify(accessLogger)
                .record(
                        ADMIN,
                        USER,
                        AdminAccessTargetType.JOB,
                        null,
                        "/api/v1/admin/reconstructions");
    }

    @Test
    void 모르는_상태_실패_코드_단계_시각은_COMMON_001이다() {
        assertCode(() -> list("EXTRACTING", null, null, null), "COMMON_001");
        assertCode(() -> list(null, "GPU_ON_FIRE", null, null), "COMMON_001");
        assertCode(() -> list(null, null, "EXTRACT", null), "COMMON_001");
        assertCode(() -> list(null, null, null, "2026-11-07"), "COMMON_001");
    }

    @Test
    void 상세는_구간_실패_이전_실패_입력을_묶고_조회_기록을_남긴다() {
        ReconstructionJob job = ReconstructionJob.queue(USER, "upload-1");
        ReflectionTestUtils.setField(job, "id", JOB);
        ReflectionTestUtils.setField(job, "createdAt", NOW.minusSeconds(600));
        ReflectionTestUtils.setField(job, "framesReadyAt", NOW.minusSeconds(500));
        job.start(NOW.minusSeconds(490));
        job.fail(NOW, "[\"FIT_FAILED\"]", "colmap exited 1", 490_000, "{\"faceDetected\":true}");
        when(jobRepository.findById(JOB)).thenReturn(Optional.of(job));
        ReconstructionJobStage select =
                ReconstructionJobStage.start(
                        JOB, PipelineStage.FRAME_SELECT, 1, "gpu-1", NOW.minusSeconds(490));
        select.succeed(NOW.minusSeconds(480));
        ReconstructionJobStage recon =
                ReconstructionJobStage.start(
                        JOB, PipelineStage.RECONSTRUCT, 1, "gpu-1", NOW.minusSeconds(480));
        recon.fail(NOW, "colmap exited 1", null);
        when(stageRepository.findAllByJobIdOrderByStartedAtAscIdAsc(JOB))
                .thenReturn(List.of(select, recon));
        when(queries.previousFailures(USER, JOB, NOW.minusSeconds(600), 5))
                .thenReturn(
                        List.of(
                                new AdminJobQueries.FailureRow(
                                        "prev-1", NOW.minusSeconds(9000), "[\"QUALITY_LIGHT\"]")));
        when(queries.upload("upload-1"))
                .thenReturn(
                        Optional.of(
                                new AdminJobQueries.UploadRow(
                                        12_000,
                                        "WEB_RECORDER",
                                        null,
                                        48,
                                        "{\"trace\":[[0,1.5,-2.0,true]]}",
                                        "{\"width\":1080,\"fps\":30}")));

        AdminJobDetailResponse detail =
                service.detail(ADMIN, JOB, "/api/v1/admin/reconstructions/" + JOB);

        assertThat(detail.segments())
                .extracting(AdminJobDetailResponse.Segment::key)
                .containsExactly("EXTRACT_WAIT", "GPU_WAIT", "FRAME_SELECT", "RECONSTRUCT");
        assertThat(detail.slowestSegment()).isEqualTo("RECONSTRUCT");
        assertThat(detail.failure())
                .isEqualTo(
                        new AdminJobDetailResponse.Failure(
                                "RECONSTRUCT", List.of("FIT_FAILED"), null, "colmap exited 1"));
        assertThat(detail.previousFailures().getFirst().codes()).containsExactly("QUALITY_LIGHT");
        assertThat(detail.input().frameCount()).isEqualTo(48);
        assertThat(detail.input().quality()).isEqualTo(java.util.Map.of("faceDetected", true));
        assertThat(detail.input().captureTrace())
                .isEqualTo(java.util.Map.of("trace", List.of(List.of(0, 1.5, -2.0, true))));
        assertThat(detail.input().videoMeta())
                .isEqualTo(java.util.Map.of("width", 1080, "fps", 30));
        assertThat(detail.faceModelId()).isNull();
        verify(accessLogger)
                .record(
                        ADMIN,
                        USER,
                        AdminAccessTargetType.JOB,
                        JOB,
                        "/api/v1/admin/reconstructions/" + JOB);
    }

    @Test
    void 촬영_기록과_영상_정보가_없거나_읽지_못하면_null이다() {
        ReconstructionJob job = ReconstructionJob.queue(USER, "upload-1");
        ReflectionTestUtils.setField(job, "id", JOB);
        ReflectionTestUtils.setField(job, "createdAt", NOW.minusSeconds(60));
        when(jobRepository.findById(JOB)).thenReturn(Optional.of(job));
        when(stageRepository.findAllByJobIdOrderByStartedAtAscIdAsc(JOB)).thenReturn(List.of());
        when(queries.upload("upload-1"))
                .thenReturn(
                        Optional.of(
                                new AdminJobQueries.UploadRow(
                                        12_000, null, null, null, null, "not-json")));

        AdminJobDetailResponse.Input input = service.detail(ADMIN, JOB, "/x").input();

        assertThat(input.captureTrace()).isNull();
        assertThat(input.videoMeta()).isNull();

        when(queries.upload("upload-1")).thenReturn(Optional.empty());
        AdminJobDetailResponse.Input missing = service.detail(ADMIN, JOB, "/x").input();

        assertThat(missing.captureTrace()).isNull();
        assertThat(missing.videoMeta()).isNull();
    }

    @Test
    void 없는_작업은_COMMON_002이고_조회_기록을_남기지_않는다() {
        when(jobRepository.findById(JOB)).thenReturn(Optional.empty());

        assertCode(() -> service.detail(ADMIN, JOB, "/x"), "COMMON_002");
        verify(accessLogger, never()).record(any(), any(), any(), any(), any());
    }

    @Test
    void 대기열_순번은_목록마다_따로_세고_추출_중은_순번이_없고_GPU는_들어온_순서다() {
        when(queries.queued())
                .thenReturn(
                        List.of(
                                // 추출 lease가 살아 있다(30초 전에 가져감) — 추출 중
                                row("e0", 400, 30, null, NOW.minusSeconds(30)),
                                // GPU 대기, 접수는 가장 빠르지만 GPU 대기열에는 나중에 들어왔다
                                row("g1", 300, 20, NOW.minusSeconds(20), null),
                                // lease가 끝났다(11분 전에 가져감) — 다시 추출 대기
                                row("e1", 250, 660, null, NOW.minusSeconds(660)),
                                row("g2", 220, 60, NOW.minusSeconds(60), null),
                                row("e2", 100, 100, null, null)));

        AdminJobQueueResponse queue = service.queue();

        assertThat(queue.gpu())
                .containsExactly(
                        new AdminJobQueueResponse.Entry(
                                1L, "g2", USER, NOW.minusSeconds(60), 60_000),
                        new AdminJobQueueResponse.Entry(
                                2L, "g1", USER, NOW.minusSeconds(20), 20_000));
        assertThat(queue.extract())
                .extracting(
                        AdminJobQueueResponse.Entry::jobId,
                        AdminJobQueueResponse.Entry::position,
                        AdminJobQueueResponse.Entry::waitedMs)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("e0", null, 400_000L),
                        org.assertj.core.groups.Tuple.tuple("e1", 1L, 250_000L),
                        org.assertj.core.groups.Tuple.tuple("e2", 2L, 100_000L));
    }

    private static AdminJobQueries.QueuedRow row(
            String jobId,
            long createdSecondsAgo,
            long updatedSecondsAgo,
            Instant framesReadyAt,
            Instant extractClaimedAt) {
        return new AdminJobQueries.QueuedRow(
                jobId,
                USER,
                NOW.minusSeconds(createdSecondsAgo),
                NOW.minusSeconds(updatedSecondsAgo),
                framesReadyAt,
                extractClaimedAt);
    }

    private void list(String status, String failCode, String stage, String from) {
        service.list(
                ADMIN,
                new AdminJobService.ListQuery(
                        status, failCode, stage, null, from, null, null, null),
                "/api/v1/admin/reconstructions");
    }

    private static void assertCode(Runnable call, String code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(((ErrorCode) e.errorCode()).code()).isEqualTo(code));
    }
}
