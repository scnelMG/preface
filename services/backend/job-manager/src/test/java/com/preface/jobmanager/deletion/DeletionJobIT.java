package com.preface.jobmanager.deletion;

import static com.preface.jobmanager.ItRows.ago;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.preface.jobmanager.ItRows;
import com.preface.jobmanager.JobManagerTestcontainers;
import com.preface.jobmanager.deletion.service.DeletionJob;
import com.preface.jobmanager.deletion.service.DeletionStorage;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** 자동 삭제를 실제 MySQL·Redis로 확인한다. S3만 mock이다. */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@Import(JobManagerTestcontainers.class)
class DeletionJobIT {

    private static final String LOCK_KEY = "deletion:lock:scheduler";

    @Autowired DeletionJob deletionJob;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;

    @MockitoBean DeletionStorage storage;

    private ItRows rows;
    private String userId;

    @BeforeEach
    void setUp() {
        rows = new ItRows(jdbc);
        redis.delete(LOCK_KEY);
        userId = rows.user();
    }

    @Test
    void 보관이_끝난_원본_빈_시안_30일_지난_시안과_3D를_지우고_모든_삭제를_기록한다() {
        // 원본 영상: 실패 작업(종료+24h 지남)은 삭제, 진행 중 작업·보관 기간 남은 것은 유지
        String failedUpload = rows.upload(userId, "UPLOADED", ago(Duration.ofHours(1)));
        rows.job(userId, failedUpload, "FAILED");
        String runningUpload = rows.upload(userId, "UPLOADED", ago(Duration.ofHours(1)));
        rows.job(userId, runningUpload, "RUNNING");
        String freshUpload = rows.upload(userId, "UPLOADED", ago(Duration.ofHours(-1)));
        rows.job(userId, freshUpload, "CANCELED");
        // 웹 녹화 촬영 기록(S15P31B204-640, 합성 값): 원본을 지우면 함께 비우고, 남는 원본은 그대로
        jdbc.update(
                "update face_upload set capture_trace = '{\"trace\":[[0,1,1,1]]}' where id in (?, ?)",
                failedUpload,
                freshUpload);

        // 시안: 살아 있는 3D 아래
        String liveModel = rows.faceModel(userId, null);
        String oldEmpty =
                rows.simulation(userId, liveModel, false, ago(Duration.ofHours(25)), null);
        String newEmpty = rows.simulation(userId, liveModel, false, ago(Duration.ofHours(1)), null);
        String oldSoft =
                rows.simulation(
                        userId,
                        liveModel,
                        true,
                        ago(Duration.ofDays(40)),
                        ago(Duration.ofDays(31)));
        String newSoft =
                rows.simulation(
                        userId,
                        liveModel,
                        true,
                        ago(Duration.ofDays(40)),
                        ago(Duration.ofDays(29)));

        // 30일 지난 소프트 삭제 3D: 메시·리그·표정 리그·텍스처·썸네일 + 5방향 사진 + 연결 시안
        String oldModel = rows.faceModel(userId, ago(Duration.ofDays(31)));
        String prefix = ItRows.modelPrefix(userId, rows.jobIdOf(oldModel));
        jdbc.update(
                "update face_model set rig_object_key = ?, expression_object_key = ? where id = ?",
                prefix + "rig.json",
                prefix + "expression.json",
                oldModel);
        List<String> modelKeys =
                new ArrayList<>(
                        List.of(
                                prefix + "mesh.glb",
                                prefix + "rig.json",
                                prefix + "expression.json",
                                prefix + "texture.png",
                                prefix + "thumbnail.webp"));
        for (String angle : ItRows.ANGLES) {
            modelKeys.add(rows.captureImage(userId, oldModel, angle));
        }
        String linkedSim =
                rows.simulation(
                        userId, oldModel, true, ago(Duration.ofDays(40)), ago(Duration.ofDays(31)));
        String recentModel = rows.faceModel(userId, ago(Duration.ofDays(29)));

        deletionJob.runOnce();

        // 원본 영상
        verify(storage).delete(ItRows.uploadKey(userId, failedUpload));
        verify(storage, never()).delete(ItRows.uploadKey(userId, runningUpload));
        verify(storage, never()).delete(ItRows.uploadKey(userId, freshUpload));
        assertThat(uploadStatus(failedUpload)).isEqualTo("DELETED");
        assertThat(uploadStatus(runningUpload)).isEqualTo("UPLOADED");
        assertThat(uploadStatus(freshUpload)).isEqualTo("UPLOADED");
        assertThat(captureTrace(failedUpload)).isNull();
        assertThat(captureTrace(freshUpload)).isNotNull();
        assertThat(logs("FACE_UPLOAD", failedUpload))
                .singleElement()
                .satisfies(
                        log -> {
                            assertThat(log.get("reason")).isEqualTo("RETENTION_POLICY");
                            assertThat(log.get("status")).isEqualTo("DONE");
                            assertThat(log.get("completed_at")).isNotNull();
                        });

        // 시안
        assertThat(rows.exists("simulation", oldEmpty)).isFalse();
        assertThat(rows.exists("simulation", newEmpty)).isTrue();
        assertThat(rows.exists("simulation", oldSoft)).isFalse();
        assertThat(rows.exists("simulation", newSoft)).isTrue();
        assertThat(rows.exists("simulation", linkedSim)).isFalse();
        assertThat(logs("SIMULATION", oldEmpty))
                .singleElement()
                .satisfies(log -> assertThat(log.get("reason")).isEqualTo("EMPTY_SIMULATION"));
        assertThat(logs("SIMULATION", oldSoft))
                .singleElement()
                .satisfies(log -> assertThat(log.get("reason")).isEqualTo("SOFT_DELETE_EXPIRED"));
        assertThat(logs("SIMULATION", linkedSim)).hasSize(1);

        // 3D와 5방향 사진: 행은 CASCADE로 사라지고 출력은 PUT URL 만료를 기다린다
        assertThat(rows.exists("face_model", oldModel)).isFalse();
        assertThat(rows.exists("face_model", recentModel)).isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from face_capture_image where face_model_id = ?",
                                Integer.class,
                                oldModel))
                .isZero();
        modelKeys.forEach(key -> verify(storage, never()).delete(key));
        assertThat(logs("RECON_OUTPUT", oldModel))
                .hasSize(5)
                .allSatisfy(log -> assertThat(log.get("status")).isEqualTo("PENDING"));
        jdbc.update(
                "update data_deletion_log set created_at = ? where target_type = 'RECON_OUTPUT' and user_id = ?",
                ago(Duration.ofHours(2)),
                userId);
        deletionJob.runOnce();
        modelKeys.forEach(key -> verify(storage).delete(key));
        // S3 객체 1개 = 1행: 메시·리그·표정 리그·텍스처·썸네일은 3D ID, 사진은 사진 ID
        List<Map<String, Object>> modelLogs =
                jdbc.queryForList(
                        "select * from data_deletion_log where user_id = ?"
                                + " and target_type = 'RECON_OUTPUT'",
                        userId);
        assertThat(modelLogs)
                .extracting(log -> log.get("object_key"))
                .containsExactlyInAnyOrderElementsOf(modelKeys);
        assertThat(logs("RECON_OUTPUT", oldModel)).hasSize(5);
        assertThat(modelLogs)
                .filteredOn(log -> !oldModel.equals(log.get("target_id")))
                .hasSize(5)
                .allSatisfy(log -> assertThat(log.get("target_id")).isNotEqualTo(oldModel));
        assertThat(modelLogs)
                .allSatisfy(
                        log -> {
                            assertThat(log.get("status")).isEqualTo("DONE");
                            assertThat(log.get("reason")).isEqualTo("SOFT_DELETE_EXPIRED");
                        });
    }

    @Test
    void 다른_작업이_남긴_PENDING의_S3_객체를_지우고_실패하면_재시도하다가_한도에서_FAILED가_된다() {
        String okKey = "users/" + userId + "/models/synthetic/captures/FRONT.jpg";
        String badKey = "users/" + userId + "/models/synthetic/mesh.glb";
        String ok = rows.pendingLog(userId, "USER", userId, okKey, "WITHDRAWAL");
        String bad = rows.pendingLog(userId, "FACE_MODEL", userId, badKey, "CONSENT_WITHDRAWN");
        String record = rows.pendingLog(userId, "USER", userId, null, "WITHDRAWAL");
        doThrow(new RuntimeException("synthetic s3 failure")).when(storage).delete(badKey);

        deletionJob.runOnce();

        assertThat(log(ok)).containsEntry("status", "DONE").containsEntry("retry_count", 0);
        assertThat(log(ok).get("completed_at")).isNotNull();
        assertThat(log(record)).containsEntry("status", "DONE");
        assertThat(log(bad)).containsEntry("status", "PENDING").containsEntry("retry_count", 1);

        deletionJob.runOnce();
        assertThat(log(bad)).containsEntry("status", "PENDING").containsEntry("retry_count", 2);

        deletionJob.runOnce();
        assertThat(log(bad)).containsEntry("status", "FAILED").containsEntry("retry_count", 3);
        assertThat(log(bad).get("completed_at")).isNull();
    }

    @Test
    void 복원_출력은_늦은_PUT이_끝날_때까지_기다렸다가_삭제한다() {
        String key = "users/" + userId + "/models/synthetic/a1/mesh.glb";
        String output = rows.pendingLog(userId, "RECON_OUTPUT", userId, key, "RETENTION_POLICY");

        deletionJob.runOnce();

        verify(storage, never()).delete(key);
        assertThat(log(output)).containsEntry("status", "PENDING");

        jdbc.update(
                "update data_deletion_log set created_at = ? where id = ?",
                ago(Duration.ofHours(2)),
                output);
        deletionJob.runOnce();

        verify(storage).delete(key);
        assertThat(log(output)).containsEntry("status", "DONE");
    }

    @Test
    void 다른_인스턴스가_락을_잡고_있으면_돌지_않고_끝나면_락을_풀어_둔다() {
        String key = "users/" + userId + "/uploads/synthetic.mp4";
        String pending = rows.pendingLog(userId, "USER", userId, key, "WITHDRAWAL");
        redis.opsForValue().set(LOCK_KEY, "other-instance", Duration.ofMinutes(5));

        deletionJob.scheduled();

        verify(storage, never()).delete(anyString());
        assertThat(log(pending)).containsEntry("status", "PENDING");

        redis.delete(LOCK_KEY);
        deletionJob.scheduled();

        verify(storage).delete(key);
        assertThat(log(pending)).containsEntry("status", "DONE");
        assertThat(redis.hasKey(LOCK_KEY)).isFalse();
    }

    @Test
    void 구십일_지난_알림과_탈퇴_1년_지난_회원의_동의_삭제_기록을_지우되_끝나지_않은_삭제가_있으면_남긴다() {
        // 알림: 91일 전은 삭제, 89일 전은 유지
        String oldNotification = notification(userId, ago(Duration.ofDays(91)));
        String newNotification = notification(userId, ago(Duration.ofDays(89)));

        // 탈퇴 1년 지남 + 삭제 모두 끝남 → 회원·동의·기록 삭제
        String purged = withdrawnUser(ago(Duration.ofDays(366)));
        consent(purged);
        String doneLog = rows.pendingLog(purged, "FACE_UPLOAD", purged, null, "WITHDRAWAL");
        jdbc.update("update data_deletion_log set status = 'DONE' where id = ?", doneLog);
        // 탈퇴 1년 지났지만 S3 삭제가 아직 PENDING → 남김(무엇을 지울지 잃지 않게)
        String waiting = withdrawnUser(ago(Duration.ofDays(400)));
        consent(waiting);
        String key = "users/" + waiting + "/uploads/synthetic.mp4";
        doThrow(new RuntimeException("synthetic s3 failure")).when(storage).delete(key);
        rows.pendingLog(waiting, "FACE_UPLOAD", waiting, key, "WITHDRAWAL");
        // 탈퇴 1년 안 됨 → 남김
        String recent = withdrawnUser(ago(Duration.ofDays(300)));
        consent(recent);

        DeletionJob.Summary summary = deletionJob.runOnce();

        assertThat(summary.notifications()).isEqualTo(1);
        assertThat(rows.exists("notification", oldNotification)).isFalse();
        assertThat(rows.exists("notification", newNotification)).isTrue();

        assertThat(summary.withdrawnUsers()).isEqualTo(1);
        assertThat(rows.exists("user", purged)).isFalse();
        assertThat(countByUser("user_consent", purged)).isZero();
        assertThat(countByUser("data_deletion_log", purged)).isZero();
        assertThat(rows.exists("user", waiting)).isTrue();
        assertThat(countByUser("user_consent", waiting)).isEqualTo(1);
        assertThat(rows.exists("user", recent)).isTrue();
        assertThat(countByUser("user_consent", recent)).isEqualTo(1);
        assertThat(rows.exists("user", userId)).as("탈퇴하지 않은 회원").isTrue();
    }

    private String notification(String ownerId, LocalDateTime createdAt) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into notification(id, user_id, type, title, created_at)"
                        + " values (?, ?, 'RECON_FAILED', 'synthetic', ?)",
                id,
                ownerId,
                createdAt);
        return id;
    }

    private String withdrawnUser(LocalDateTime deletedAt) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into user(id, status, deleted_at) values (?, 'WITHDRAWN', ?)",
                id,
                deletedAt);
        return id;
    }

    private void consent(String ownerId) {
        jdbc.update(
                "insert into user_consent(id, user_id, consent_document_id, consent_type, agreed,"
                        + " acted_at) select uuid(), ?, id, consent_type, 1, utc_timestamp(3)"
                        + " from consent_document where consent_type = 'TERMS' limit 1",
                ownerId);
    }

    private int countByUser(String table, String ownerId) {
        Integer n =
                jdbc.queryForObject(
                        "select count(*) from " + table + " where user_id = ?",
                        Integer.class,
                        ownerId);
        return n == null ? 0 : n;
    }

    private String captureTrace(String uploadId) {
        return jdbc.queryForObject(
                "select capture_trace from face_upload where id = ?", String.class, uploadId);
    }

    private String uploadStatus(String uploadId) {
        return jdbc.queryForObject(
                "select status from face_upload where id = ?", String.class, uploadId);
    }

    private List<Map<String, Object>> logs(String targetType, String targetId) {
        return jdbc.queryForList(
                "select * from data_deletion_log where target_type = ? and target_id = ?",
                targetType,
                targetId);
    }

    private Map<String, Object> log(String id) {
        return jdbc.queryForMap("select * from data_deletion_log where id = ?", id);
    }
}
