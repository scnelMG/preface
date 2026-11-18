package com.preface.api.reconstruction.service;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 복원 흐름이 쓰는 {@code face_upload}·{@code user}·{@code user_consent} 접근(SQL).
 *
 * <p>JPA 엔티티 대신 SQL인 이유: {@code face_upload} 엔티티는 업로드 기능(S15P31B204-290)이 만든다. 같은 엔티티를 두 브랜치에서 따로
 * 만들면 병합 때 충돌하므로, 엔티티가 생기면 이 클래스를 그 저장소로 바꾼다. JPA 트랜잭션 안에서 부르면 같은 커넥션·트랜잭션을 쓴다.
 *
 * <p>DATETIME은 UTC {@link LocalDateTime}으로 주고받는다(JDBC 드라이버의 시간대 변환을 피하려고).
 */
@Component
@RequiredArgsConstructor
class FaceUploadGateway {

    private final JdbcTemplate jdbc;

    record UploadRow(
            String id,
            String userId,
            String objectKey,
            String contentType,
            long sizeBytes,
            String checksumSha256,
            String status,
            String framesObjectKey,
            Long framesSizeBytes,
            String framesChecksumSha256,
            Integer frameCount,
            String lensMetaJson,
            String captureMethod,
            String deviceModel,
            String captureTraceJson) {

        boolean expiredOrDeleted() {
            return "DELETED".equals(status) || "EXPIRED".equals(status);
        }
    }

    Optional<UploadRow> find(String uploadId) {
        List<UploadRow> rows =
                jdbc.query(
                        "select id, user_id, object_key, content_type, size_bytes, checksum_sha256,"
                                + " status, frames_object_key, frames_size_bytes,"
                                + " frames_checksum_sha256, frame_count, lens_meta, capture_method, device_model,"
                                + " capture_trace"
                                + " from face_upload where id = ?",
                        FaceUploadGateway::mapUpload,
                        uploadId);
        return rows.stream().findFirst();
    }

    /** 사용자 행을 잠가 같은 사용자의 작업 생성을 한 줄로 세운다("한 번에 하나만", REC_002). */
    boolean lockUser(String userId) {
        return !jdbc.queryForList(
                        "select id from user where id = ? and status = 'ACTIVE' for update",
                        String.class,
                        userId)
                .isEmpty();
    }

    /** 얼굴 데이터 동의의 현재 상태 = 가장 최근 기록. */
    boolean hasFaceDataConsent(String userId) {
        List<Boolean> latest =
                jdbc.queryForList(
                        "select agreed from user_consent where user_id = ? and consent_type = 'FACE_DATA'"
                                + " order by acted_at desc limit 1",
                        Boolean.class,
                        userId);
        return !latest.isEmpty() && Boolean.TRUE.equals(latest.getFirst());
    }

    void markUploaded(String uploadId, Instant now) {
        jdbc.update(
                "update face_upload set status = 'UPLOADED', uploaded_at = coalesce(uploaded_at, ?)"
                        + " where id = ?",
                utc(now),
                uploadId);
    }

    /** 결과 보고 뒤: 워커가 뽑은 영상 정보를 남기고 원본 삭제 예정 시각을 정한다. */
    void recordResult(String uploadId, String videoMetaJson, Instant retentionExpiresAt) {
        jdbc.update(
                "update face_upload set video_meta = coalesce(?, video_meta),"
                        + " retention_expires_at = ? where id = ?",
                videoMetaJson,
                utc(retentionExpiresAt),
                uploadId);
    }

    /**
     * 추출 결과 저장(INT-EXT-03 성공): 프레임 묶음·렌즈·영상 정보를 남기고 원본 영상 주소를 지운다. 영상 key의 S3 삭제는 호출자가
     * data_deletion_log에 먼저 남긴다.
     */
    void saveFrames(
            String uploadId,
            String framesObjectKey,
            long sizeBytes,
            String checksumSha256,
            int frameCount,
            String lensMetaJson,
            String videoMetaJson,
            Instant now) {
        jdbc.update(
                "update face_upload set frames_object_key = ?, frames_size_bytes = ?,"
                        + " frames_checksum_sha256 = ?, frame_count = ?, lens_meta = ?,"
                        + " video_meta = coalesce(?, video_meta), object_key = null,"
                        + " retention_expires_at = ? where id = ?",
                framesObjectKey,
                sizeBytes,
                checksumSha256,
                frameCount,
                lensMetaJson,
                videoMetaJson,
                utc(now),
                uploadId);
    }

    /** 프레임 묶음 삭제를 예약한 뒤 주소를 지운다. */
    void clearFrames(String uploadId) {
        jdbc.update("update face_upload set frames_object_key = null where id = ?", uploadId);
    }

    private static UploadRow mapUpload(ResultSet rs, int rowNum) throws SQLException {
        return new UploadRow(
                rs.getString("id"),
                rs.getString("user_id"),
                rs.getString("object_key"),
                rs.getString("content_type"),
                rs.getLong("size_bytes"),
                rs.getString("checksum_sha256"),
                rs.getString("status"),
                rs.getString("frames_object_key"),
                rs.getObject("frames_size_bytes", Long.class),
                rs.getString("frames_checksum_sha256"),
                rs.getObject("frame_count", Integer.class),
                rs.getString("lens_meta"),
                rs.getString("capture_method"),
                rs.getString("device_model"),
                rs.getString("capture_trace"));
    }

    private static LocalDateTime utc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
