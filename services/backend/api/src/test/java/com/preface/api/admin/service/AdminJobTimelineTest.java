package com.preface.api.admin.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.admin.dto.AdminJobDetailResponse.Segment;
import com.preface.common.reconstruction.entity.PipelineStage;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionJobStage;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.LongStream;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** 작업 상세 구간 계산과 처리 시간 통계(S15P31B204-652). */
class AdminJobTimelineTest {

    private static final String JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40";
    private static final Instant T0 = Instant.parse("2026-11-07T03:00:00Z");

    @Test
    void 모든_시각이_있으면_대기_추출_GPU_단계_순서로_구간을_만든다() {
        ReconstructionJob job = job();
        ReflectionTestUtils.setField(job, "extractClaimedAt", T0.plusSeconds(2));
        ReflectionTestUtils.setField(job, "framesReadyAt", T0.plusSeconds(20));
        ReflectionTestUtils.setField(job, "startedAt", T0.plusSeconds(23));
        ReconstructionJobStage extract = closed(PipelineStage.EXTRACT, 1, 2, 20);
        ReconstructionJobStage select = closed(PipelineStage.FRAME_SELECT, 1, 23, 32);
        ReconstructionJobStage recon = closed(PipelineStage.RECONSTRUCT, 1, 32, 200);

        List<Segment> segments = AdminJobTimeline.segments(job, List.of(extract, select, recon));

        assertThat(segments)
                .extracting(Segment::key)
                .containsExactly(
                        "EXTRACT_WAIT", "EXTRACT", "GPU_WAIT", "FRAME_SELECT", "RECONSTRUCT");
        assertThat(segments)
                .extracting(Segment::durationMs)
                .containsExactly(2000L, 18_000L, 3000L, 9000L, 168_000L);
        assertThat(segments.get(0).attempt()).isNull();
        assertThat(segments.get(0).status()).isNull();
        assertThat(segments.get(1).attempt()).isEqualTo(1);
        assertThat(segments.get(1).status()).isEqualTo("SUCCEEDED");
        assertThat(AdminJobTimeline.slowest(segments)).isEqualTo("RECONSTRUCT");
    }

    @Test
    void 기록이_없는_예전_작업은_아는_시각으로만_대기_구간을_만들고_끝을_모르면_null이다() {
        ReconstructionJob job = job();
        // 추출을 가져가기 전에 끝난 작업: 추출 시작도 프레임 준비도 없다
        List<Segment> waiting = AdminJobTimeline.segments(job, List.of());
        assertThat(waiting).hasSize(1);
        assertThat(waiting.getFirst().key()).isEqualTo("EXTRACT_WAIT");
        assertThat(waiting.getFirst().finishedAt()).isNull();
        assertThat(waiting.getFirst().durationMs()).isNull();
        assertThat(AdminJobTimeline.slowest(waiting)).isNull();

        // 단계 기록 없이 시각 컬럼만 있는 작업(이 기능 배포 전)
        ReflectionTestUtils.setField(job, "extractClaimedAt", T0.plusSeconds(5));
        ReflectionTestUtils.setField(job, "framesReadyAt", T0.plusSeconds(30));
        List<Segment> legacy = AdminJobTimeline.segments(job, List.of());
        assertThat(legacy).extracting(Segment::key).containsExactly("EXTRACT_WAIT", "GPU_WAIT");
        assertThat(legacy.get(0).durationMs()).isEqualTo(5000L);
        assertThat(legacy.get(1).finishedAt()).isNull();
    }

    @Test
    void 진행_중인_단계는_끝과_길이가_null이다() {
        ReconstructionJob job = job();
        ReconstructionJobStage running =
                ReconstructionJobStage.start(
                        JOB, PipelineStage.RECONSTRUCT, 2, "gpu-1", T0.plusSeconds(40));

        List<Segment> segments = AdminJobTimeline.segments(job, List.of(running));

        Segment last = segments.getLast();
        assertThat(last.key()).isEqualTo("RECONSTRUCT");
        assertThat(last.status()).isEqualTo("RUNNING");
        assertThat(last.attempt()).isEqualTo(2);
        assertThat(last.finishedAt()).isNull();
        assertThat(last.durationMs()).isNull();
    }

    @Test
    void p95는_nearest_rank이고_평균은_반올림한다() {
        List<Long> hundred = new ArrayList<>(LongStream.rangeClosed(1, 100).boxed().toList());
        java.util.Collections.shuffle(hundred, new java.util.Random(1));
        assertThat(AdminJobTimeline.p95(hundred)).isEqualTo(95L);
        assertThat(AdminJobTimeline.p95(List.of(7L))).isEqualTo(7L);
        assertThat(AdminJobTimeline.p95(List.of(1L, 2L, 3L))).isEqualTo(3L);
        assertThat(AdminJobTimeline.p95(List.of())).isNull();
        assertThat(AdminJobTimeline.average(List.of(1L, 2L))).isEqualTo(2L);
        assertThat(AdminJobTimeline.average(List.of())).isNull();
    }

    private static ReconstructionJob job() {
        ReconstructionJob job = ReconstructionJob.queue("user-1", "upload-1");
        ReflectionTestUtils.setField(job, "id", JOB);
        ReflectionTestUtils.setField(job, "createdAt", T0);
        return job;
    }

    private static ReconstructionJobStage closed(
            PipelineStage stage, int attempt, long startSec, long endSec) {
        ReconstructionJobStage row =
                ReconstructionJobStage.start(JOB, stage, attempt, "w", T0.plusSeconds(startSec));
        row.succeed(T0.plusSeconds(endSec));
        return row;
    }
}
