package com.preface.api.admin.service;

import com.preface.api.admin.dto.AdminJobDetailResponse;
import com.preface.api.admin.dto.AdminJobListItem;
import com.preface.api.admin.dto.AdminJobQueueResponse;
import com.preface.api.admin.dto.AdminJobSummaryResponse;
import com.preface.api.admin.dto.AdminPage;
import com.preface.api.reconstruction.service.ReconstructionProperties;
import com.preface.common.admin.entity.AdminAccessTargetType;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.reconstruction.entity.JobStageStatus;
import com.preface.common.reconstruction.entity.ReconstructionFailCode;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionJobStage;
import com.preface.common.reconstruction.entity.ReconstructionStage;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import com.preface.common.reconstruction.entity.ReconstructionWaitQueue;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import com.preface.common.reconstruction.repository.ReconstructionJobStageRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * 관리자 복원 작업 화면(S15P31B204-652, 관리자 API 계약 2~5). 읽기만 한다.
 *
 * <p>회원 한 명의 작업을 보여 주는 조회(회원 조건이 있는 목록, 상세)는 {@link AdminAccessLogger}로 조회 기록을 남긴다. 기간 집계·대기열은 회원
 * 데이터를 열어 보는 것이 아니라 남기지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminJobService {

    static final int DEFAULT_SIZE = 20;
    static final int MAX_SIZE = 100;
    static final int PREVIOUS_FAILURES = 5;

    /** "오늘"의 기준 시간대. 사용자·운영자가 한국 시간으로 하루를 본다. */
    static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Seoul");

    private static final Set<String> STATUSES = names(ReconstructionStatus.values());
    private static final Set<String> FAIL_CODES = names(ReconstructionFailCode.values());
    private static final Set<String> STAGES = names(ReconstructionStage.values());

    private final AdminJobQueries queries;
    private final ReconstructionJobRepository jobRepository;
    private final ReconstructionJobStageRepository stageRepository;
    private final FaceModelRepository faceModelRepository;
    private final AdminAccessLogger accessLogger;
    private final AdminJobProperties properties;
    private final ReconstructionProperties reconstructionProperties;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    /** 목록 조건(요청 값 그대로). */
    public record ListQuery(
            String status,
            String failCode,
            String stage,
            String userId,
            String from,
            String to,
            Integer page,
            Integer size) {}

    /** 계약 2. {@code period}: today(한국 시간 오늘 0시부터) | 7d | 30d. */
    @Transactional(readOnly = true)
    public AdminJobSummaryResponse summary(String period) {
        Instant to = clock.instant();
        Instant from = periodStart(period, to);

        Map<String, Long> counts = new LinkedHashMap<>();
        for (ReconstructionStatus status : ReconstructionStatus.values()) {
            counts.put(status.name(), 0L);
        }
        queries.countByStatus(from, to)
                .forEach(c -> counts.merge(c.status(), c.count(), Long::sum));
        long total = counts.values().stream().mapToLong(Long::longValue).sum();
        long succeeded = counts.get(ReconstructionStatus.SUCCEEDED.name());
        long failed = counts.get(ReconstructionStatus.FAILED.name());
        Double failureRate =
                succeeded + failed == 0
                        ? null
                        : Math.round(failed * 1000.0 / (succeeded + failed)) / 1000.0;

        Map<String, Long> byCode = new TreeMap<>();
        for (String json : queries.failCodesJson(from, to)) {
            readCodes(json).stream().distinct().forEach(code -> byCode.merge(code, 1L, Long::sum));
        }
        List<AdminJobSummaryResponse.FailCodeCount> failCodes =
                byCode.entrySet().stream()
                        .sorted(
                                Map.Entry.<String, Long>comparingByValue(Comparator.reverseOrder())
                                        .thenComparing(Map.Entry.comparingByKey()))
                        .map(
                                e ->
                                        new AdminJobSummaryResponse.FailCodeCount(
                                                e.getKey(), e.getValue()))
                        .toList();

        List<Long> durations = queries.succeededDurations(from, to);
        Duration stuck = properties.stuckThreshold();
        return new AdminJobSummaryResponse(
                period,
                from,
                to,
                counts,
                total,
                failureRate,
                failCodes,
                new AdminJobSummaryResponse.Duration(
                        AdminJobTimeline.average(durations),
                        AdminJobTimeline.p95(durations),
                        properties.targetDuration().toMillis()),
                queries.countStuck(to.minus(stuck)),
                stuck.toMinutes());
    }

    /** 계약 3. 최신순. 회원 조건이 있으면 조회 기록(JOB, 대상 ID 없음)을 남긴다. */
    @Transactional(readOnly = true)
    public AdminPage<AdminJobListItem> list(
            String adminUserId, ListQuery query, String requestPath) {
        int page = query.page() == null ? 0 : query.page();
        int size = query.size() == null ? DEFAULT_SIZE : Math.min(query.size(), MAX_SIZE);
        if (page < 0 || size < 1) {
            throw invalid("page must be >= 0 and size >= 1");
        }
        String userId = blankToNull(query.userId());
        if (userId != null && userId.length() > 36) {
            throw invalid("userId invalid");
        }
        AdminJobQueries.Filter filter =
                new AdminJobQueries.Filter(
                        allowed("status", query.status(), STATUSES),
                        allowed("failCode", query.failCode(), FAIL_CODES),
                        allowed("stage", query.stage(), STAGES),
                        userId,
                        parseInstant("from", query.from()),
                        parseInstant("to", query.to()));

        long total = queries.count(filter);
        List<AdminJobListItem> items =
                total == 0
                        ? List.of()
                        : queries.list(filter, page, size).stream()
                                .map(
                                        r ->
                                                new AdminJobListItem(
                                                        r.jobId(),
                                                        r.userId(),
                                                        r.status(),
                                                        r.stage(),
                                                        readCodes(r.failCodesJson()),
                                                        r.durationMs(),
                                                        r.createdAt(),
                                                        r.finishedAt(),
                                                        r.captureMethod(),
                                                        r.deviceModel()))
                                .toList();
        if (userId != null) {
            accessLogger.record(adminUserId, userId, AdminAccessTargetType.JOB, null, requestPath);
        }
        return AdminPage.of(items, page, size, total);
    }

    /** 계약 4. 없는 작업은 COMMON_002. 조회 기록(JOB, 작업 ID)을 남긴다. */
    @Transactional(readOnly = true)
    public AdminJobDetailResponse detail(String adminUserId, String jobId, String requestPath) {
        ReconstructionJob job =
                jobRepository
                        .findById(jobId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        List<ReconstructionJobStage> rows =
                stageRepository.findAllByJobIdOrderByStartedAtAscIdAsc(jobId);
        List<AdminJobDetailResponse.Segment> segments = AdminJobTimeline.segments(job, rows);

        List<AdminJobDetailResponse.PreviousFailure> previous =
                queries
                        .previousFailures(
                                job.getUserId(), jobId, job.getCreatedAt(), PREVIOUS_FAILURES)
                        .stream()
                        .map(
                                f ->
                                        new AdminJobDetailResponse.PreviousFailure(
                                                f.jobId(),
                                                f.createdAt(),
                                                readCodes(f.failCodesJson())))
                        .toList();
        AdminJobDetailResponse.Input input =
                queries.upload(job.getFaceUploadId())
                        .map(
                                u ->
                                        new AdminJobDetailResponse.Input(
                                                u.durationMs(),
                                                u.captureMethod(),
                                                u.deviceModel(),
                                                u.frameCount(),
                                                readJson(
                                                        "quality_report",
                                                        job.getQualityReportJson()),
                                                readJson("capture_trace", u.captureTraceJson()),
                                                readJson("video_meta", u.videoMetaJson())))
                        .orElseGet(
                                () ->
                                        new AdminJobDetailResponse.Input(
                                                null,
                                                null,
                                                null,
                                                null,
                                                readJson(
                                                        "quality_report",
                                                        job.getQualityReportJson()),
                                                null,
                                                null));
        String faceModelId =
                faceModelRepository
                        .findByReconstructionJobId(jobId)
                        .map(FaceModel::getId)
                        .orElse(null);

        accessLogger.record(
                adminUserId, job.getUserId(), AdminAccessTargetType.JOB, jobId, requestPath);
        return new AdminJobDetailResponse(
                job.getId(),
                job.getUserId(),
                job.getStatus().name(),
                job.getStage() == null ? null : job.getStage().name(),
                job.getCreatedAt(),
                job.getExtractClaimedAt(),
                job.getFramesReadyAt(),
                job.getStartedAt(),
                job.getFinishedAt(),
                job.getDurationMs(),
                job.getExtractAttempts(),
                segments,
                AdminJobTimeline.slowest(segments),
                failure(job, rows),
                previous,
                input,
                faceModelId);
    }

    /**
     * 계약 5. 순번은 사용자 queuePosition과 같은 기준(S15P31B204-729): 대기열마다 따로 센다. 추출 대기는 지금 가져갈 수 있는 작업을
     * {@code created_at, id} 순으로, GPU 대기는 {@code updated_at, id} 순으로. 추출 중(lease가 살아 있는) 작업은 추출 목록에
     * 두되 순번은 null이다.
     */
    @Transactional(readOnly = true)
    public AdminJobQueueResponse queue() {
        Instant now = clock.instant();
        Instant staleBefore =
                now.truncatedTo(ChronoUnit.SECONDS)
                        .minus(reconstructionProperties.extractLeaseTimeout());
        List<AdminJobQueries.QueuedRow> rows = queries.queued();
        List<AdminJobQueueResponse.Entry> extract = new java.util.ArrayList<>();
        long extractPosition = 0;
        for (AdminJobQueries.QueuedRow row : rows) {
            if (row.framesReadyAt() != null) {
                continue;
            }
            boolean waiting =
                    ReconstructionWaitQueue.of(
                                    ReconstructionStatus.QUEUED,
                                    null,
                                    row.extractClaimedAt(),
                                    staleBefore)
                            == ReconstructionWaitQueue.EXTRACT;
            extract.add(entry(waiting ? ++extractPosition : null, row, row.createdAt(), now));
        }
        List<AdminJobQueueResponse.Entry> gpu = new java.util.ArrayList<>();
        long gpuPosition = 0;
        for (AdminJobQueries.QueuedRow row :
                rows.stream()
                        .filter(r -> r.framesReadyAt() != null)
                        .sorted(
                                Comparator.comparing(
                                                AdminJobQueries.QueuedRow::updatedAt,
                                                Comparator.nullsFirst(Comparator.naturalOrder()))
                                        .thenComparing(AdminJobQueries.QueuedRow::jobId))
                        .toList()) {
            gpu.add(entry(++gpuPosition, row, row.updatedAt(), now));
        }
        return new AdminJobQueueResponse(extract, gpu);
    }

    private static AdminJobQueueResponse.Entry entry(
            Long position, AdminJobQueries.QueuedRow row, Instant queuedAt, Instant now) {
        return new AdminJobQueueResponse.Entry(
                position,
                row.jobId(),
                row.userId(),
                queuedAt,
                queuedAt == null ? 0 : Math.max(0, Duration.between(queuedAt, now).toMillis()));
    }

    private AdminJobDetailResponse.Failure failure(
            ReconstructionJob job, List<ReconstructionJobStage> rows) {
        if (job.getStatus() != ReconstructionStatus.FAILED) {
            return null;
        }
        String stage =
                rows.stream()
                        .filter(r -> r.getStatus() == JobStageStatus.FAILED)
                        .reduce((first, second) -> second)
                        .map(r -> r.getStage().name())
                        .orElse(job.getStage() == null ? null : job.getStage().name());
        return new AdminJobDetailResponse.Failure(
                stage, readCodes(job.getFailCodesJson()), null, job.getFailDetail());
    }

    static Instant periodStart(String period, Instant now) {
        if (period == null) {
            throw invalid("period required");
        }
        return switch (period) {
            case "today" ->
                    LocalDate.ofInstant(now, BUSINESS_ZONE).atStartOfDay(BUSINESS_ZONE).toInstant();
            case "7d" -> now.minus(Duration.ofDays(7));
            case "30d" -> now.minus(Duration.ofDays(30));
            default -> throw invalid("period must be today, 7d or 30d");
        };
    }

    private List<String> readCodes(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (RuntimeException e) {
            log.warn("fail_codes unreadable, skipped");
            return List.of();
        }
    }

    /** JSON 열 원본을 그대로 응답에 싣는다. 비었거나 읽지 못하면 null(로그에는 열 이름만 남긴다). */
    private Object readJson(String column, String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (RuntimeException e) {
            log.warn("{} unreadable, skipped", column);
            return null;
        }
    }

    private static String allowed(String field, String value, Set<String> allowed) {
        String v = blankToNull(value);
        if (v != null && !allowed.contains(v)) {
            throw invalid(field + " invalid");
        }
        return v;
    }

    private static Instant parseInstant(String field, String value) {
        String v = blankToNull(value);
        if (v == null) {
            return null;
        }
        try {
            return Instant.parse(v);
        } catch (DateTimeParseException e) {
            throw invalid(field + " must be ISO-8601 instant");
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static Set<String> names(Enum<?>[] values) {
        return Arrays.stream(values).map(Enum::name).collect(Collectors.toUnmodifiableSet());
    }

    private static BusinessException invalid(String detail) {
        return new BusinessException(CommonErrorCode.INVALID_REQUEST, detail);
    }
}
