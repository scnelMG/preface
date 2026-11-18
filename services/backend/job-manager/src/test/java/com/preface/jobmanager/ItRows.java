package com.preface.jobmanager;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** 통합 테스트용 합성 행. 실제 회원·얼굴 데이터가 아니다. DATETIME은 UTC로 넣는다. */
public final class ItRows {

    public static final String CHECKSUM = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    public static final String[] ANGLES = {"FRONT", "LEFT", "RIGHT", "LEFT_45", "RIGHT_45"};

    private final JdbcTemplate jdbc;

    public ItRows(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public static LocalDateTime ago(Duration duration) {
        return utc(Instant.now().minus(duration));
    }

    public static LocalDateTime utc(Instant instant) {
        return LocalDateTime.ofInstant(instant.truncatedTo(ChronoUnit.SECONDS), ZoneOffset.UTC);
    }

    public String user() {
        String id = UUID.randomUUID().toString();
        jdbc.update("insert into user(id, status) values (?, 'ACTIVE')", id);
        return id;
    }

    public String upload(String userId, String status, LocalDateTime retentionExpiresAt) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into face_upload(id, user_id, object_key, content_type, size_bytes,"
                        + " duration_ms, status, url_expires_at, retention_expires_at,"
                        + " checksum_sha256) values (?, ?, ?, 'video/mp4', 1000, 30000, ?, ?, ?, ?)",
                id,
                userId,
                uploadKey(userId, id),
                status,
                ago(Duration.ofDays(2)),
                retentionExpiresAt,
                CHECKSUM);
        return id;
    }

    public static String uploadKey(String userId, String uploadId) {
        return "users/" + userId + "/uploads/" + uploadId + ".mp4";
    }

    public String job(String userId, String uploadId, String status) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into reconstruction_job(id, user_id, face_upload_id, status, started_at)"
                        + " values (?, ?, ?, ?, ?)",
                id,
                userId,
                uploadId,
                status,
                "QUEUED".equals(status) ? null : ago(Duration.ofHours(3)));
        return id;
    }

    /** 성공한 작업과 3D(메시·텍스처·썸네일 key 포함). {@code deletedAt}이 있으면 소프트 삭제 상태. */
    public String faceModel(String userId, LocalDateTime deletedAt) {
        String jobId =
                job(userId, upload(userId, "DELETED", ago(Duration.ofDays(40))), "SUCCEEDED");
        String id = UUID.randomUUID().toString();
        String prefix = modelPrefix(userId, jobId);
        jdbc.update(
                "insert into face_model(id, user_id, reconstruction_job_id, mesh_object_key,"
                        + " texture_object_key, thumbnail_object_key, morph_schema_version,"
                        + " deleted_at) values (?, ?, ?, ?, ?, ?, 'v1', ?)",
                id,
                userId,
                jobId,
                prefix + "mesh.glb",
                prefix + "texture.png",
                prefix + "thumbnail.webp",
                deletedAt);
        return id;
    }

    public static String modelPrefix(String userId, String jobId) {
        return "users/" + userId + "/models/" + jobId + "/";
    }

    public String jobIdOf(String faceModelId) {
        return jdbc.queryForObject(
                "select reconstruction_job_id from face_model where id = ?",
                String.class,
                faceModelId);
    }

    /** 5방향 사진 행. key를 돌려준다. */
    public String captureImage(String userId, String faceModelId, String angle) {
        String key = modelPrefix(userId, jobIdOf(faceModelId)) + "captures/" + angle + ".jpg";
        jdbc.update(
                "insert into face_capture_image(id, face_model_id, user_id, angle, object_key)"
                        + " values (uuid(), ?, ?, ?, ?)",
                faceModelId,
                userId,
                angle,
                key);
        return key;
    }

    public String simulation(
            String userId,
            String faceModelId,
            boolean hasChanges,
            LocalDateTime createdAt,
            LocalDateTime deletedAt) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into simulation(id, user_id, face_model_id, title, morph_state,"
                        + " has_changes, created_at, deleted_at)"
                        + " values (?, ?, ?, 'it 시안', ?, ?, ?, ?)",
                id,
                userId,
                faceModelId,
                "{\"schemaVersion\":\"v1\",\"weights\":{}}",
                hasChanges,
                createdAt,
                deletedAt);
        return id;
    }

    /** 다른 기능(탈퇴·동의 철회 등)이 남기는 것과 같은 PENDING 삭제 기록. */
    public String pendingLog(
            String userId, String targetType, String targetId, String objectKey, String reason) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into data_deletion_log(id, user_id, target_type, target_id, object_key,"
                        + " reason) values (?, ?, ?, ?, ?, ?)",
                id,
                userId,
                targetType,
                targetId,
                objectKey,
                reason);
        return id;
    }

    public boolean exists(String table, String id) {
        Integer n =
                jdbc.queryForObject(
                        "select count(*) from " + table + " where id = ?", Integer.class, id);
        return n != null && n > 0;
    }
}
