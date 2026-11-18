package com.preface.api.reconstruction.service;

import com.preface.common.reconstruction.entity.ReconstructionFailCode;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository.FinishedJob;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.Map;
import java.util.function.ToDoubleFunction;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 3D 작업 대기열과 최근 1시간 결과를 DB에서 세어 지표로 낸다(S15P31B204-455).
 *
 * <ul>
 *   <li>{@code preface_reconstruction_jobs{state}}: 지금 추출 대기(extracting)·GPU 대기(gpu_queue)·실행
 *       중(running)
 *   <li>{@code preface_reconstruction_finished_last_hour{outcome}}: 최근 1시간에 끝난 작업(succeeded·failed)
 *   <li>{@code preface_reconstruction_fail_codes_last_hour{code}}: 위 실패 작업의 실패 코드별 수(한 작업에 코드가 둘이면
 *       둘 다 센다)
 * </ul>
 *
 * <p>작업을 끝내는 곳이 api(워커 결과·추출 실패)와 job-manager(lease·대기 시간 초과) 둘이라, 끝날 때 세지 않고 DB를 본다. 그래서 재시작해도 값이
 * 이어진다. INTERNAL 재시도로 대기열에 돌아간 작업은 끝난 것이 아니어서 세지 않는다.
 *
 * <p>Prometheus가 30초마다 읽는다. 한 번 읽을 때 게이지마다 DB를 부르지 않게 {@link #REFRESH} 동안 같은 값을 쓴다. DB를 못 읽으면
 * NaN이다.
 */
@Slf4j
@Component
class ReconstructionJobMetrics {

    static final Duration REFRESH = Duration.ofSeconds(20);
    static final Duration FINISHED_WINDOW = Duration.ofHours(1);

    record Snapshot(
            long extracting,
            long gpuQueue,
            long running,
            long succeeded,
            long failed,
            Map<ReconstructionFailCode, Long> failCodes) {}

    private final ReconstructionJobRepository jobRepository;
    private final JsonColumns jsonColumns;
    private final Clock clock;
    private Snapshot snapshot;
    private Instant takenAt;

    ReconstructionJobMetrics(
            ReconstructionJobRepository jobRepository,
            JsonColumns jsonColumns,
            Clock clock,
            MeterRegistry meters) {
        this.jobRepository = jobRepository;
        this.jsonColumns = jsonColumns;
        this.clock = clock;
        jobs(meters, "extracting", Snapshot::extracting);
        jobs(meters, "gpu_queue", Snapshot::gpuQueue);
        jobs(meters, "running", Snapshot::running);
        finished(meters, "succeeded", Snapshot::succeeded);
        finished(meters, "failed", Snapshot::failed);
        for (ReconstructionFailCode code : ReconstructionFailCode.values()) {
            Gauge.builder(
                            "preface.reconstruction.fail_codes.last_hour",
                            this,
                            m -> m.read(s -> s.failCodes().getOrDefault(code, 0L)))
                    .description("최근 1시간에 실패로 끝난 3D 작업의 실패 코드별 수")
                    .tag("code", code.name())
                    .register(meters);
        }
    }

    private void jobs(MeterRegistry meters, String state, ToDoubleFunction<Snapshot> value) {
        Gauge.builder("preface.reconstruction.jobs", this, m -> m.read(value))
                .description("지금 대기·실행 중인 3D 작업 수")
                .tag("state", state)
                .register(meters);
    }

    private void finished(MeterRegistry meters, String outcome, ToDoubleFunction<Snapshot> value) {
        Gauge.builder("preface.reconstruction.finished.last_hour", this, m -> m.read(value))
                .description("최근 1시간에 끝난 3D 작업 수")
                .tag("outcome", outcome)
                .register(meters);
    }

    private double read(ToDoubleFunction<Snapshot> value) {
        Snapshot current = current();
        return current == null ? Double.NaN : value.applyAsDouble(current);
    }

    synchronized Snapshot current() {
        Instant now = clock.instant();
        if (takenAt == null || !now.isBefore(takenAt.plus(REFRESH))) {
            takenAt = now;
            try {
                snapshot = take(now);
            } catch (RuntimeException e) {
                log.warn("recon job metrics unavailable: {}", e.getClass().getSimpleName());
                snapshot = null;
            }
        }
        return snapshot;
    }

    private Snapshot take(Instant now) {
        long succeeded = 0;
        long failed = 0;
        Map<ReconstructionFailCode, Long> failCodes = new EnumMap<>(ReconstructionFailCode.class);
        for (FinishedJob job : jobRepository.findFinishedSince(now.minus(FINISHED_WINDOW))) {
            if (job.getStatus() == ReconstructionStatus.SUCCEEDED) {
                succeeded++;
            } else if (job.getStatus() == ReconstructionStatus.FAILED) {
                failed++;
                for (String code :
                        new HashSet<>(jsonColumns.readStringList(job.getFailCodesJson()))) {
                    failCodes.merge(failCode(code), 1L, Long::sum);
                }
            }
        }
        return new Snapshot(
                jobRepository.countByStatusAndFramesReadyAtIsNull(ReconstructionStatus.QUEUED),
                jobRepository.countByStatusAndFramesReadyAtIsNotNull(ReconstructionStatus.QUEUED),
                jobRepository.countByStatus(ReconstructionStatus.RUNNING),
                succeeded,
                failed,
                failCodes);
    }

    /** 모르는 코드(이전 버전이 남긴 값 등)는 INTERNAL로 센다. */
    private static ReconstructionFailCode failCode(String code) {
        try {
            return ReconstructionFailCode.valueOf(code);
        } catch (IllegalArgumentException e) {
            return ReconstructionFailCode.INTERNAL;
        }
    }
}
