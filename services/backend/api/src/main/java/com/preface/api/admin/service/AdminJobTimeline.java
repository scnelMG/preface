package com.preface.api.admin.service;

import com.preface.api.admin.dto.AdminJobDetailResponse.Segment;
import com.preface.common.reconstruction.entity.PipelineStage;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionJobStage;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/**
 * 작업 상세의 구간 계산과 처리 시간 통계(S15P31B204-652). 저장하지 않고 읽은 값으로만 계산한다.
 *
 * <p>구간 순서: {@code EXTRACT_WAIT}(접수 → 첫 추출 시작) → {@code EXTRACT}(시도마다) → {@code GPU_WAIT}(프레임 준비 →
 * GPU 첫 시작) → GPU 단계들(단계 기록 순서). 시작 시각을 모르면 구간을 빼고, 끝 시각을 모르면(진행 중·기록 없음) 끝과 길이를 null로 둔다.
 */
final class AdminJobTimeline {

    static final String EXTRACT_WAIT = "EXTRACT_WAIT";
    static final String GPU_WAIT = "GPU_WAIT";

    private AdminJobTimeline() {}

    static List<Segment> segments(ReconstructionJob job, List<ReconstructionJobStage> rows) {
        List<ReconstructionJobStage> extract =
                rows.stream().filter(r -> r.getStage() == PipelineStage.EXTRACT).toList();
        List<ReconstructionJobStage> gpu =
                rows.stream().filter(r -> r.getStage() != PipelineStage.EXTRACT).toList();
        List<Segment> segments = new ArrayList<>();

        Instant extractStart =
                extract.isEmpty() ? job.getExtractClaimedAt() : extract.getFirst().getStartedAt();
        addWait(segments, EXTRACT_WAIT, job.getCreatedAt(), extractStart);
        extract.forEach(row -> segments.add(stage(row)));
        addWait(segments, GPU_WAIT, job.getFramesReadyAt(), job.getStartedAt());
        gpu.forEach(row -> segments.add(stage(row)));
        return segments;
    }

    /** 가장 오래 걸린 구간의 key. 길이를 아는 구간이 없으면 null. */
    static String slowest(List<Segment> segments) {
        return segments.stream()
                .filter(s -> s.durationMs() != null)
                .max(Comparator.comparingLong(Segment::durationMs))
                .map(Segment::key)
                .orElse(null);
    }

    /** 반올림한 평균. 비었으면 null. */
    static Long average(List<Long> values) {
        if (values.isEmpty()) {
            return null;
        }
        return Math.round(values.stream().mapToLong(Long::longValue).average().orElse(0));
    }

    /** 95백분위(nearest-rank: 오름차순 ceil(0.95·n)번째). 비었으면 null. */
    static Long p95(List<Long> values) {
        List<Long> sorted = values.stream().filter(Objects::nonNull).sorted().toList();
        if (sorted.isEmpty()) {
            return null;
        }
        int rank = (int) Math.ceil(0.95 * sorted.size());
        return sorted.get(Math.max(0, rank - 1));
    }

    private static void addWait(List<Segment> segments, String key, Instant start, Instant end) {
        if (start == null) {
            return;
        }
        segments.add(new Segment(key, start, end, millis(start, end), null, null));
    }

    private static Segment stage(ReconstructionJobStage row) {
        return new Segment(
                row.getStage().name(),
                row.getStartedAt(),
                row.getFinishedAt(),
                row.getDurationMs() == null ? null : row.getDurationMs().longValue(),
                row.getAttempt(),
                row.getStatus().name());
    }

    private static Long millis(Instant start, Instant end) {
        if (start == null || end == null) {
            return null;
        }
        return Math.max(0, Duration.between(start, end).toMillis());
    }
}
