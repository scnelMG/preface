package com.preface.api.reconstruction.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.common.reconstruction.entity.JobStageStatus;
import com.preface.common.reconstruction.entity.PipelineStage;
import com.preface.common.reconstruction.entity.ReconstructionJobStage;
import com.preface.common.reconstruction.entity.ReconstructionStage;
import com.preface.common.reconstruction.repository.ReconstructionJobStageRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** 단계별 기록의 열고 닫기 규칙(S15P31B204-652). 저장소는 메모리 목록으로 흉내 낸다. */
class ReconstructionStageRecorderTest {

    private static final String JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40";
    private static final Instant T0 = Instant.parse("2026-11-07T03:00:00Z");

    private final ReconstructionJobStageRepository repository =
            mock(ReconstructionJobStageRepository.class);
    private final MutableClock clock = new MutableClock(T0);
    private final List<ReconstructionJobStage> rows = new ArrayList<>();
    private ReconstructionStageRecorder recorder;

    @BeforeEach
    void setUp() {
        when(repository.save(any()))
                .thenAnswer(
                        invocation -> {
                            ReconstructionJobStage row = invocation.getArgument(0);
                            rows.add(row);
                            return row;
                        });
        when(repository.findAllByJobIdAndStatus(eq(JOB), eq(JobStageStatus.RUNNING)))
                .thenAnswer(invocation -> rows.stream().filter(r -> r.isRunning()).toList());
        recorder = new ReconstructionStageRecorder(repository, clock);
    }

    @Test
    void 같은_단계의_반복_보고는_새_행을_만들지_않는다() {
        recorder.gpuProgress(JOB, ReconstructionStage.FRAME_SELECT, 1, "gpu-1");
        clock.plusSeconds(5);
        recorder.gpuProgress(JOB, ReconstructionStage.FRAME_SELECT, 1, "gpu-1");
        recorder.gpuProgress(JOB, ReconstructionStage.FRAME_SELECT, 1, "gpu-1");

        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().isRunning()).isTrue();
        assertThat(rows.getFirst().getStartedAt()).isEqualTo(T0);
        assertThat(rows.getFirst().getWorkerId()).isEqualTo("gpu-1");
    }

    @Test
    void 단계가_바뀌면_앞_단계를_성공으로_닫고_새_단계를_연다() {
        recorder.gpuProgress(JOB, ReconstructionStage.FRAME_SELECT, 1, "gpu-1");
        clock.plusSeconds(9);
        recorder.gpuProgress(JOB, ReconstructionStage.RECONSTRUCT, 1, "gpu-1");

        assertThat(rows).hasSize(2);
        ReconstructionJobStage first = rows.get(0);
        assertThat(first.getStatus()).isEqualTo(JobStageStatus.SUCCEEDED);
        assertThat(first.getDurationMs()).isEqualTo(9000);
        ReconstructionJobStage second = rows.get(1);
        assertThat(second.getStage()).isEqualTo(PipelineStage.RECONSTRUCT);
        assertThat(second.getAttempt()).isEqualTo(1);
        assertThat(second.isRunning()).isTrue();
        assertThat(second.getStartedAt()).isEqualTo(T0.plusSeconds(9));
    }

    @Test
    void 다른_시도의_열린_행은_실패로_닫고_같은_단계라도_새_시도_행을_연다() {
        recorder.gpuProgress(JOB, ReconstructionStage.RECONSTRUCT, 1, "gpu-1");
        clock.plusSeconds(60);
        recorder.gpuProgress(JOB, ReconstructionStage.RECONSTRUCT, 2, "gpu-2");

        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).getStatus()).isEqualTo(JobStageStatus.FAILED);
        assertThat(rows.get(0).getDetail())
                .isEqualTo(ReconstructionStageRecorder.DETAIL_SUPERSEDED);
        assertThat(rows.get(1).getAttempt()).isEqualTo(2);
        assertThat(rows.get(1).isRunning()).isTrue();
    }

    @Test
    void 결과_성공은_열린_행을_성공으로_실패는_상세와_함께_실패로_닫는다() {
        recorder.gpuProgress(JOB, ReconstructionStage.FINALIZE, 1, "gpu-1");
        clock.plusSeconds(3);
        recorder.succeedOpen(JOB);
        assertThat(rows.getFirst().getStatus()).isEqualTo(JobStageStatus.SUCCEEDED);
        assertThat(rows.getFirst().getFinishedAt()).isEqualTo(T0.plusSeconds(3));

        recorder.gpuProgress(JOB, ReconstructionStage.RECONSTRUCT, 2, "gpu-1");
        recorder.failOpen(JOB, "colmap exited 1");
        assertThat(rows.get(1).getStatus()).isEqualTo(JobStageStatus.FAILED);
        assertThat(rows.get(1).getDetail()).isEqualTo("colmap exited 1");
        // 닫힌 행은 다시 닫지 않는다
        recorder.failOpen(JOB, "again");
        assertThat(rows.getFirst().getStatus()).isEqualTo(JobStageStatus.SUCCEEDED);
    }

    @Test
    void 추출을_다시_가져가면_앞_시도의_행을_실패로_닫고_시도_번호로_새_행을_연다() {
        recorder.extractionStarted(JOB, 1, "ext-1");
        clock.plusSeconds(700);
        recorder.extractionStarted(JOB, 2, "ext-2");
        clock.plusSeconds(15);
        recorder.succeedOpen(JOB);

        assertThat(rows)
                .extracting(ReconstructionJobStage::getStage)
                .containsOnly(PipelineStage.EXTRACT);
        assertThat(rows.get(0).getStatus()).isEqualTo(JobStageStatus.FAILED);
        assertThat(rows.get(1).getAttempt()).isEqualTo(2);
        assertThat(rows.get(1).getStatus()).isEqualTo(JobStageStatus.SUCCEEDED);
        assertThat(rows.get(1).getDurationMs()).isEqualTo(15_000);
    }

    @Test
    void 기록_중_예외는_로그만_남기고_호출자에게_던지지_않는다() {
        when(repository.findAllByJobIdAndStatus(anyString(), any()))
                .thenThrow(new IllegalStateException("boom"));

        recorder.gpuProgress(JOB, ReconstructionStage.FRAME_SELECT, 1, "gpu-1");
        recorder.failOpen(JOB, "x");

        assertThat(rows).isEmpty();
    }

    @Test
    void 화면_단계는_같은_이름의_파이프라인_단계로_바뀐다() {
        for (ReconstructionStage stage : ReconstructionStage.values()) {
            assertThat(ReconstructionStageRecorder.toPipeline(stage).name())
                    .isEqualTo(stage.name());
        }
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void plusSeconds(long seconds) {
            now = now.plusSeconds(seconds);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
