package com.preface.common.reconstruction.entity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class ReconstructionJobStageTest {

    private static final Instant START = Instant.parse("2026-11-07T03:00:00.000Z");

    @Test
    void 시작하면_진행_중이고_성공하면_소요_시간이_남는다() {
        ReconstructionJobStage stage =
                ReconstructionJobStage.start("job-1", PipelineStage.EXTRACT, 1, "worker-a", START);
        assertThat(stage.isRunning()).isTrue();

        stage.succeed(START.plusMillis(15_250));

        assertThat(stage.getStatus()).isEqualTo(JobStageStatus.SUCCEEDED);
        assertThat(stage.getFinishedAt()).isEqualTo(START.plusMillis(15_250));
        assertThat(stage.getDurationMs()).isEqualTo(15_250);
        assertThat(stage.getDetail()).isNull();
    }

    @Test
    void 실패하면_상세를_1000자로_잘라_남긴다() {
        ReconstructionJobStage stage =
                ReconstructionJobStage.start("job-1", PipelineStage.RECONSTRUCT, 1, null, START);

        stage.fail(START.plusSeconds(3), "x".repeat(1500), "logs/job-1/reconstruct.txt");

        assertThat(stage.getStatus()).isEqualTo(JobStageStatus.FAILED);
        assertThat(stage.getDetail()).hasSize(1000);
        assertThat(stage.getLogObjectKey()).isEqualTo("logs/job-1/reconstruct.txt");
    }

    @Test
    void 시도_번호는_1부터다() {
        assertThatThrownBy(
                        () ->
                                ReconstructionJobStage.start(
                                        "job-1", PipelineStage.EXTRACT, 0, null, START))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
