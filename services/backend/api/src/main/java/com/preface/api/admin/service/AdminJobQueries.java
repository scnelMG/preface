package com.preface.api.admin.service;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 관리자 작업 화면의 읽기 SQL(S15P31B204-652). 여러 회원·기간에 걸친 집계와 동적 조건이라 엔티티 대신 SQL로 읽는다. 저장은 하지 않는다.
 *
 * <p>DATETIME은 UTC {@link LocalDateTime}으로 주고받는다(복원 흐름의 {@code FaceUploadGateway}와 같다). 인덱스: 상태 조건은
 * {@code idx_recon_extract(status, …)}, 회원 조건은 {@code idx_job_user_created}·{@code
 * idx_job_user_status}를 탄다. 기간만 거는 조회는 표를 훑지만 30일치 작업은 수천 건 이하라 충분히 빠르다.
 */
@Component
@RequiredArgsConstructor
class AdminJobQueries {

    private final JdbcTemplate jdbc;

    /** 목록 조건. null인 값은 조건에서 뺀다. {@code to}는 포함하지 않는다. */
    record Filter(
            String status,
            String failCode,
            String stage,
            String userId,
            Instant from,
            Instant to) {}

    record ListRow(
            String jobId,
            String userId,
            String status,
            String stage,
            String failCodesJson,
            Integer durationMs,
            Instant createdAt,
            Instant finishedAt,
            String captureMethod,
            String deviceModel) {}

    record StatusCount(String status, long count) {}

    record QueuedRow(
            String jobId,
            String userId,
            Instant createdAt,
            Instant updatedAt,
            Instant framesReadyAt,
            Instant extractClaimedAt) {}

    record FailureRow(String jobId, Instant createdAt, String failCodesJson) {}

    /**
     * @param captureTraceJson {@code capture_trace}(V28) 원본. 웹 녹화만 있고, 원본 영상을 지우면 함께 비워진다
     * @param videoMetaJson {@code video_meta} 원본(추출 워커가 채움)
     */
    record UploadRow(
            Integer durationMs,
            String captureMethod,
            String deviceModel,
            Integer frameCount,
            String captureTraceJson,
            String videoMetaJson) {}

    List<StatusCount> countByStatus(Instant from, Instant to) {
        return jdbc.query(
                "select status, count(*) as cnt from reconstruction_job"
                        + " where created_at >= ? and created_at < ? group by status",
                (rs, n) -> new StatusCount(rs.getString("status"), rs.getLong("cnt")),
                utc(from),
                utc(to));
    }

    List<String> failCodesJson(Instant from, Instant to) {
        return jdbc.queryForList(
                "select fail_codes from reconstruction_job where status = 'FAILED'"
                        + " and created_at >= ? and created_at < ? and fail_codes is not null",
                String.class,
                utc(from),
                utc(to));
    }

    List<Long> succeededDurations(Instant from, Instant to) {
        return jdbc.queryForList(
                "select duration_ms from reconstruction_job where status = 'SUCCEEDED'"
                        + " and created_at >= ? and created_at < ? and duration_ms is not null",
                Long.class,
                utc(from),
                utc(to));
    }

    long countStuck(Instant updatedBefore) {
        Long count =
                jdbc.queryForObject(
                        "select count(*) from reconstruction_job"
                                + " where status in ('QUEUED', 'RUNNING') and updated_at < ?",
                        Long.class,
                        utc(updatedBefore));
        return count == null ? 0 : count;
    }

    long count(Filter filter) {
        List<Object> args = new ArrayList<>();
        String where = where(filter, args);
        Long count =
                jdbc.queryForObject(
                        "select count(*) from reconstruction_job j" + where,
                        Long.class,
                        args.toArray());
        return count == null ? 0 : count;
    }

    /** 최신순(created_at desc, id desc). */
    List<ListRow> list(Filter filter, int page, int size) {
        List<Object> args = new ArrayList<>();
        String where = where(filter, args);
        args.add(size);
        args.add((long) page * size);
        return jdbc.query(
                "select j.id, j.user_id, j.status, j.stage, j.fail_codes, j.duration_ms,"
                        + " j.created_at, j.finished_at, u.capture_method, u.device_model"
                        + " from reconstruction_job j left join face_upload u on u.id = j.face_upload_id"
                        + where
                        + " order by j.created_at desc, j.id desc limit ? offset ?",
                AdminJobQueries::mapListRow,
                args.toArray());
    }

    /**
     * 대기 중(QUEUED) 작업 전체를 접수 순서(created_at, id)로. 대기열별 순번은 {@link AdminJobService#queue()}가 매긴다.
     */
    List<QueuedRow> queued() {
        return jdbc.query(
                "select id, user_id, created_at, updated_at, frames_ready_at, extract_claimed_at"
                        + " from reconstruction_job"
                        + " where status = 'QUEUED' order by created_at, id",
                (rs, n) ->
                        new QueuedRow(
                                rs.getString("id"),
                                rs.getString("user_id"),
                                instant(rs, "created_at"),
                                instant(rs, "updated_at"),
                                instant(rs, "frames_ready_at"),
                                instant(rs, "extract_claimed_at")));
    }

    /** 같은 회원의 이 작업 이전(같은 시각 포함) 실패, 최근 {@code limit}건. */
    List<FailureRow> previousFailures(
            String userId, String excludeJobId, Instant createdAtOrBefore, int limit) {
        return jdbc.query(
                "select id, created_at, fail_codes from reconstruction_job"
                        + " where user_id = ? and status = 'FAILED' and id <> ? and created_at <= ?"
                        + " order by created_at desc, id desc limit ?",
                (rs, n) ->
                        new FailureRow(
                                rs.getString("id"),
                                instant(rs, "created_at"),
                                rs.getString("fail_codes")),
                userId,
                excludeJobId,
                utc(createdAtOrBefore),
                limit);
    }

    Optional<UploadRow> upload(String uploadId) {
        return jdbc
                .query(
                        "select duration_ms, capture_method, device_model, frame_count,"
                                + " capture_trace, video_meta from face_upload where id = ?",
                        (rs, n) ->
                                new UploadRow(
                                        rs.getObject("duration_ms", Integer.class),
                                        rs.getString("capture_method"),
                                        rs.getString("device_model"),
                                        rs.getObject("frame_count", Integer.class),
                                        rs.getString("capture_trace"),
                                        rs.getString("video_meta")),
                        uploadId)
                .stream()
                .findFirst();
    }

    private static String where(Filter filter, List<Object> args) {
        StringBuilder sql = new StringBuilder(" where 1 = 1");
        if (filter.status() != null) {
            sql.append(" and j.status = ?");
            args.add(filter.status());
        }
        if (filter.failCode() != null) {
            sql.append(" and json_contains(j.fail_codes, json_quote(?))");
            args.add(filter.failCode());
        }
        if (filter.stage() != null) {
            sql.append(" and j.stage = ?");
            args.add(filter.stage());
        }
        if (filter.userId() != null) {
            sql.append(" and j.user_id = ?");
            args.add(filter.userId());
        }
        if (filter.from() != null) {
            sql.append(" and j.created_at >= ?");
            args.add(utc(filter.from()));
        }
        if (filter.to() != null) {
            sql.append(" and j.created_at < ?");
            args.add(utc(filter.to()));
        }
        return sql.toString();
    }

    private static ListRow mapListRow(ResultSet rs, int rowNum) throws SQLException {
        return new ListRow(
                rs.getString("id"),
                rs.getString("user_id"),
                rs.getString("status"),
                rs.getString("stage"),
                rs.getString("fail_codes"),
                rs.getObject("duration_ms", Integer.class),
                instant(rs, "created_at"),
                instant(rs, "finished_at"),
                rs.getString("capture_method"),
                rs.getString("device_model"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        LocalDateTime value = rs.getObject(column, LocalDateTime.class);
        return value == null ? null : value.toInstant(ZoneOffset.UTC);
    }

    private static LocalDateTime utc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
