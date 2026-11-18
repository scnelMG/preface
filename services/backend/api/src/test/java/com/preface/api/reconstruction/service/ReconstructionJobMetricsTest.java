package com.preface.api.reconstruction.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.service.WorkerPresenceTest.MovingClock;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository.FinishedJob;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class ReconstructionJobMetricsTest {

    private static final Instant NOW = Instant.parse("2026-11-03T00:00:00Z");

    private final ReconstructionJobRepository jobRepository =
            mock(ReconstructionJobRepository.class);
    private final MovingClock clock = new MovingClock(NOW);
    private final MeterRegistry meters = new SimpleMeterRegistry();

    @BeforeEach
    void setUp() {
        new ReconstructionJobMetrics(
                jobRepository, new JsonColumns(JsonMapper.builder().build()), clock, meters);
    }

    private double gauge(String name, String tag, String value) {
        return meters.get(name).tag(tag, value).gauge().value();
    }

    private static FinishedJob finished(ReconstructionStatus status, String failCodesJson) {
        return new FinishedJob() {
            @Override
            public ReconstructionStatus getStatus() {
                return status;
            }

            @Override
            public String getFailCodesJson() {
                return failCodesJson;
            }
        };
    }

    @Test
    void 대기열은_추출_대기와_GPU_대기와_실행_중으로_나눠_센다() {
        when(jobRepository.countByStatusAndFramesReadyAtIsNull(ReconstructionStatus.QUEUED))
                .thenReturn(2L);
        when(jobRepository.countByStatusAndFramesReadyAtIsNotNull(ReconstructionStatus.QUEUED))
                .thenReturn(5L);
        when(jobRepository.countByStatus(ReconstructionStatus.RUNNING)).thenReturn(3L);

        assertThat(gauge("preface.reconstruction.jobs", "state", "extracting")).isEqualTo(2);
        assertThat(gauge("preface.reconstruction.jobs", "state", "gpu_queue")).isEqualTo(5);
        assertThat(gauge("preface.reconstruction.jobs", "state", "running")).isEqualTo(3);
    }

    @Test
    void 최근_1시간에_끝난_작업을_결과와_실패_코드별로_센다() {
        when(jobRepository.findFinishedSince(NOW.minus(Duration.ofHours(1))))
                .thenReturn(
                        List.of(
                                finished(ReconstructionStatus.SUCCEEDED, null),
                                finished(ReconstructionStatus.SUCCEEDED, null),
                                finished(ReconstructionStatus.FAILED, "[\"TIMEOUT\"]"),
                                finished(
                                        ReconstructionStatus.FAILED, "[\"INTERNAL\",\"INTERNAL\"]"),
                                finished(
                                        ReconstructionStatus.FAILED,
                                        "[\"QUALITY_ANGLE\",\"QUALITY_LIGHT\"]"),
                                finished(ReconstructionStatus.CANCELED, null)));

        String finished = "preface.reconstruction.finished.last_hour";
        String codes = "preface.reconstruction.fail_codes.last_hour";
        assertThat(gauge(finished, "outcome", "succeeded")).isEqualTo(2);
        assertThat(gauge(finished, "outcome", "failed")).isEqualTo(3);
        assertThat(gauge(codes, "code", "TIMEOUT")).isEqualTo(1);
        assertThat(gauge(codes, "code", "INTERNAL")).isEqualTo(1);
        assertThat(gauge(codes, "code", "QUALITY_ANGLE")).isEqualTo(1);
        assertThat(gauge(codes, "code", "QUALITY_LIGHT")).isEqualTo(1);
        assertThat(gauge(codes, "code", "FIT_FAILED")).isZero();
    }

    @Test
    void 모르는_실패_코드는_INTERNAL로_센다() {
        when(jobRepository.findFinishedSince(any()))
                .thenReturn(List.of(finished(ReconstructionStatus.FAILED, "[\"OLD_CODE\"]")));

        assertThat(gauge("preface.reconstruction.fail_codes.last_hour", "code", "INTERNAL"))
                .isEqualTo(1);
    }

    @Test
    void 이십초_안에는_DB를_다시_읽지_않는다() {
        when(jobRepository.countByStatus(ReconstructionStatus.RUNNING)).thenReturn(1L, 4L);

        assertThat(gauge("preface.reconstruction.jobs", "state", "running")).isEqualTo(1);
        assertThat(gauge("preface.reconstruction.jobs", "state", "extracting")).isZero();
        clock.advance(Duration.ofSeconds(19));
        assertThat(gauge("preface.reconstruction.jobs", "state", "running")).isEqualTo(1);
        verify(jobRepository, times(1)).countByStatus(ReconstructionStatus.RUNNING);

        clock.advance(Duration.ofSeconds(1));
        assertThat(gauge("preface.reconstruction.jobs", "state", "running")).isEqualTo(4);
    }

    @Test
    void DB를_못_읽으면_NaN이다() {
        when(jobRepository.countByStatus(ReconstructionStatus.RUNNING))
                .thenThrow(new IllegalStateException("db down"));

        assertThat(gauge("preface.reconstruction.jobs", "state", "running")).isNaN();
    }
}
