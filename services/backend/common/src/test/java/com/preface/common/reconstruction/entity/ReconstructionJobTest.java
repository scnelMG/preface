package com.preface.common.reconstruction.entity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class ReconstructionJobTest {

    private static final Instant T0 = Instant.parse("2026-10-22T06:30:00Z");

    @Test
    void 대기_작업은_시작하면_RUNNING이고_성공하면_FINALIZE_단계와_처리시간이_남는다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        job.start(T0);
        job.progress(ReconstructionStage.RECONSTRUCT, "VGGT");

        job.succeed(T0.plusSeconds(200), null, "{}");

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.SUCCEEDED);
        assertThat(job.getStage()).isEqualTo(ReconstructionStage.FINALIZE);
        assertThat(job.getEngine()).isEqualTo("VGGT");
        assertThat(job.getDurationMs()).isEqualTo(200_000);
        assertThat(job.getFinishedAt()).isEqualTo(T0.plusSeconds(200));
    }

    @Test
    void 실패하면_실패한_단계와_코드가_남는다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        job.start(T0);
        job.progress(ReconstructionStage.QUALITY_CHECK, null);

        job.fail(T0.plusSeconds(10), "[\"QUALITY_ANGLE\"]", "yaw", 9_000, null);

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
        assertThat(job.getStage()).isEqualTo(ReconstructionStage.QUALITY_CHECK);
        assertThat(job.getFailCodesJson()).contains("QUALITY_ANGLE");
        assertThat(job.getDurationMs()).isEqualTo(9_000);
    }

    @Test
    void 프레임_없이_재큐잉하면_단계가_지워지고_다시_시작해도_처음_시작_시각을_유지한다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        job.start(T0);
        job.progress(ReconstructionStage.RECONSTRUCT, "VGGT");

        job.requeue();
        job.start(T0.plusSeconds(700));

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.RUNNING);
        assertThat(job.getStage()).isNull();
        assertThat(job.getStartedAt()).isEqualTo(T0);
    }

    @Test
    void 추출을_가져가면_1단계_프레임이_준비되면_2단계이고_상태는_QUEUED_그대로다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        assertThat(job.getStage()).as("아무도 가져가기 전").isNull();

        job.claimExtraction("ex-1", T0);
        assertThat(job.getStage()).isEqualTo(ReconstructionStage.FRAME_SELECT);
        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);

        job.framesReady(T0.plusSeconds(15));
        assertThat(job.getStage()).isEqualTo(ReconstructionStage.QUALITY_CHECK);
        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
    }

    @Test
    void 추출이_끝난_작업을_GPU_lease_회수로_되돌리면_2단계로_돌아간다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        job.claimExtraction("ex-1", T0);
        job.framesReady(T0.plusSeconds(15));
        job.start(T0.plusSeconds(20));
        job.progress(ReconstructionStage.RECONSTRUCT, "COLMAP");

        job.requeue();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        assertThat(job.getStage()).isEqualTo(ReconstructionStage.QUALITY_CHECK);
        assertThat(job.getEngine()).isNull();
    }

    @Test
    void 추출을_돌려놓으면_lease가_풀리고_시도_수는_남아_다음_claim이_다음_시도가_된다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        job.claimExtraction("ex-1", T0);

        job.releaseExtraction();

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.QUEUED);
        assertThat(job.getExtractClaimedAt()).isNull();
        assertThat(job.getExtractWorkerId()).isNull();
        assertThat(job.getExtractAttempts()).isEqualTo(1);
        assertThat(job.extractionOwnedBy("ex-1", 1)).as("돌려놓은 시도의 늦은 보고는 받지 않는다").isFalse();

        job.claimExtraction("ex-2", T0.plusSeconds(5));
        assertThat(job.getExtractAttempts()).isEqualTo(2);
        assertThat(job.extractionOwnedBy("ex-2", 2)).isTrue();
    }

    @Test
    void 프레임이_준비된_작업은_추출을_돌려놓을_수_없다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        job.claimExtraction("ex-1", T0);
        job.framesReady(T0.plusSeconds(15));

        assertThatThrownBy(job::releaseExtraction).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void 추출이_실패하면_실패한_1단계가_남는다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        job.claimExtraction("ex-1", T0);

        job.failExtraction(T0.plusSeconds(5), "[\"QUALITY_NO_FACE\"]", "few faces");

        assertThat(job.getStatus()).isEqualTo(ReconstructionStatus.FAILED);
        assertThat(job.getStage()).isEqualTo(ReconstructionStage.FRAME_SELECT);
    }

    @Test
    void 시작하지_않은_작업은_진행_보고나_결과를_받을_수_없다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");

        assertThatThrownBy(() -> job.progress(ReconstructionStage.FRAME_SELECT, null))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> job.succeed(T0, null, null))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void 대기_중이거나_처리_중인_작업은_취소되고_종료_시각이_남는다() {
        ReconstructionJob queued = ReconstructionJob.queue("u", "up1");
        ReconstructionJob running = ReconstructionJob.queue("u", "up2");
        running.start(T0);

        queued.cancel(T0.plusSeconds(5));
        running.cancel(T0.plusSeconds(5));

        assertThat(queued.getStatus()).isEqualTo(ReconstructionStatus.CANCELED);
        assertThat(running.getStatus()).isEqualTo(ReconstructionStatus.CANCELED);
        assertThat(running.getFinishedAt()).isEqualTo(T0.plusSeconds(5));
        assertThatThrownBy(() -> running.succeed(T0.plusSeconds(6), null, null))
                .as("취소된 작업에는 결과를 저장할 수 없다")
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void 이미_끝난_작업은_취소할_수_없다() {
        ReconstructionJob job = ReconstructionJob.queue("u", "up");
        job.start(T0);
        job.succeed(T0.plusSeconds(10), null, null);

        assertThatThrownBy(() -> job.cancel(T0.plusSeconds(11)))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void 단계_번호는_화면_순서와_같다() {
        assertThat(ReconstructionStage.FRAME_SELECT.index()).isEqualTo(1);
        assertThat(ReconstructionStage.FINALIZE.index()).isEqualTo(4);
    }
}
