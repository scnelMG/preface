package com.preface.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.preface.TestcontainersConfiguration;
import com.preface.api.admin.service.AdminStorage;
import com.preface.api.admin.service.AdminStorage.Listing;
import com.preface.api.admin.service.AdminStorage.SignedUrl;
import com.preface.api.admin.service.AdminStorage.StoredObject;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 관리자 회원별 3D 목록·3D 파일·S3 보관 목록(S15P31B204-653)을 실제 MySQL로 확인한다. S3는 mock, 회원·key는 합성 값이다. it 프로필의
 * 관리자 환경은 local이라 촬영 사진이 열린다.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AdminUserDataIT {

    private static final String SIGNED = "https://s3.example.test/obj?X-Amz-Signature=fake";

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtProvider jwtProvider;
    @MockitoBean AdminStorage storage;

    @Test
    void 일반_회원은_403_ADM_001이다() throws Exception {
        String user = insertUser("USER");

        mockMvc.perform(
                        get("/api/v1/admin/users/" + user + "/storage")
                                .header(HttpHeaders.AUTHORIZATION, bearer(user)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("ADM_001"));
    }

    @Test
    void 삭제된_3D까지_최신순으로_시안_수와_영상_길이를_붙여_주고_조회_기록을_남긴다() throws Exception {
        String admin = insertUser("ADMIN");
        String user = insertUser("USER");
        String oldJob = newJob(user);
        String oldModel = newModel(user, oldJob, LocalDateTime.of(2026, 1, 1, 0, 0), true);
        String newJob = newJob(user);
        String newModel = newModel(user, newJob, LocalDateTime.of(2026, 2, 1, 0, 0), false);
        newSimulation(user, newModel);
        newSimulation(user, newModel);

        mockMvc.perform(
                        get("/api/v1/admin/users/" + user + "/face-models")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2))
                .andExpect(jsonPath("$.data.totalPages").value(1))
                .andExpect(jsonPath("$.data.size").value(20))
                .andExpect(jsonPath("$.data.items[0].faceModelId").value(newModel))
                .andExpect(jsonPath("$.data.items[0].jobId").value(newJob))
                .andExpect(jsonPath("$.data.items[0].jobStatus").value("SUCCEEDED"))
                .andExpect(jsonPath("$.data.items[0].videoDurationMs").value(12000))
                .andExpect(jsonPath("$.data.items[0].simulationCount").value(2))
                .andExpect(jsonPath("$.data.items[0].deletedAt").value(nullValue()))
                .andExpect(jsonPath("$.data.items[0].deleteScheduledAt").value(nullValue()))
                .andExpect(jsonPath("$.data.items[1].faceModelId").value(oldModel))
                .andExpect(jsonPath("$.data.items[1].simulationCount").value(0))
                .andExpect(jsonPath("$.data.items[1].deleteScheduledAt").isNotEmpty());

        assertThat(accessLogs(user, "FACE_MODEL")).isEqualTo(1);
    }

    @Test
    void 파일_주소는_no_store로_주고_사진을_줬으면_CAPTURE_IMAGE_기록을_더_남긴다() throws Exception {
        String admin = insertUser("ADMIN");
        String user = insertUser("USER");
        String job = newJob(user);
        String model = newModel(user, job, LocalDateTime.of(2026, 2, 1, 0, 0), false);
        jdbc.update(
                "insert into face_capture_image(id, face_model_id, user_id, angle, object_key)"
                        + " values (uuid(), ?, ?, 'FRONT', ?)",
                model,
                user,
                "users/" + user + "/models/" + job + "/a1/front.jpg");
        when(storage.presignGet(anyString()))
                .thenReturn(new SignedUrl(SIGNED, Instant.now().plus(Duration.ofMinutes(5))));

        mockMvc.perform(
                        get("/api/v1/admin/face-models/" + model + "/assets")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.data.faceModelId").value(model))
                .andExpect(jsonPath("$.data.texturedMeshUrl").value(SIGNED))
                .andExpect(jsonPath("$.data.baseMeshUrl").value(nullValue()))
                .andExpect(jsonPath("$.data.thumbnailUrl").value(nullValue()))
                .andExpect(jsonPath("$.data.captureImages[0].angle").value("FRONT"))
                .andExpect(jsonPath("$.data.captureImages[0].url").value(SIGNED));

        assertThat(accessLogs(user, "FACE_MODEL")).isEqualTo(1);
        assertThat(accessLogs(user, "CAPTURE_IMAGE")).isEqualTo(1);
    }

    @Test
    void 없는_3D는_404_COMMON_002다() throws Exception {
        String admin = insertUser("ADMIN");

        mockMvc.perform(
                        get("/api/v1/admin/face-models/" + UUID.randomUUID() + "/assets")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    @Test
    void 저장_목록은_회원_prefix만_나열해_DB와_대조하고_삭제_실패를_준다() throws Exception {
        String admin = insertUser("ADMIN");
        String user = insertUser("USER");
        String job = newJob(user);
        newModel(user, job, LocalDateTime.of(2026, 2, 1, 0, 0), false);
        String prefix = "users/" + user + "/";
        String mesh = prefix + "models/" + job + "/a1/mesh.glb";
        String orphan = prefix + "models/" + job + "/a0/mesh.glb";
        String failedKey = prefix + "models/old/a1/texture.png";
        jdbc.update(
                "insert into data_deletion_log(id, user_id, target_type, target_id, object_key,"
                        + " reason, status, retry_count) values (uuid(), ?, 'RECON_OUTPUT', uuid(), ?,"
                        + " 'SOFT_DELETE_EXPIRED', 'FAILED', 5)",
                user,
                failedKey);
        Instant now = Instant.now();
        when(storage.list(eq(prefix), anyInt()))
                .thenReturn(
                        new Listing(
                                List.of(
                                        new StoredObject(orphan, 3, now),
                                        new StoredObject(mesh, 4, now),
                                        new StoredObject(failedKey, 5, now)),
                                false));

        mockMvc.perform(
                        get("/api/v1/admin/users/" + user + "/storage")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userId").value(user))
                .andExpect(jsonPath("$.data.prefix").value(prefix))
                .andExpect(jsonPath("$.data.truncated").value(false))
                .andExpect(jsonPath("$.data.objects[0].key").value(orphan))
                .andExpect(jsonPath("$.data.objects[0].state").value("S3_ONLY"))
                .andExpect(jsonPath("$.data.objects[1].key").value(mesh))
                .andExpect(jsonPath("$.data.objects[1].state").value("OK"))
                .andExpect(jsonPath("$.data.objects[1].source").value("FACE_MODEL"))
                .andExpect(jsonPath("$.data.objects[2].key").value(failedKey))
                .andExpect(jsonPath("$.data.objects[2].state").value("DELETE_FAILED"))
                .andExpect(jsonPath("$.data.objects[3].state").value("DB_ONLY"))
                .andExpect(jsonPath("$.data.objects[3].source").value("FACE_UPLOAD"))
                .andExpect(jsonPath("$.data.deletionFailures[0].objectKey").value(failedKey))
                .andExpect(jsonPath("$.data.deletionFailures[0].retryCount").value(5));

        assertThat(accessLogs(user, "STORAGE")).isEqualTo(1);
    }

    // ---- 합성 데이터 ----

    private String newJob(String userId) {
        String uploadId = UUID.randomUUID().toString();
        jdbc.update(
                "insert into face_upload(id, user_id, object_key, content_type, size_bytes, duration_ms,"
                        + " status, url_expires_at, retention_expires_at, checksum_sha256)"
                        + " values (?, ?, ?, 'video/mp4', 1000, 12000, 'UPLOADED',"
                        + " utc_timestamp() + interval 10 minute, utc_timestamp() + interval 1 day, ?)",
                uploadId,
                userId,
                "users/" + userId + "/uploads/" + uploadId + ".mp4",
                "n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=");
        String jobId = UUID.randomUUID().toString();
        jdbc.update(
                "insert into reconstruction_job(id, user_id, face_upload_id, status)"
                        + " values (?, ?, ?, 'SUCCEEDED')",
                jobId,
                userId,
                uploadId);
        return jobId;
    }

    private String newModel(
            String userId, String jobId, LocalDateTime createdAt, boolean softDeleted) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into face_model(id, user_id, reconstruction_job_id, mesh_object_key,"
                        + " morph_schema_version, created_at, deleted_at) values (?, ?, ?, ?, 'v1', ?, ?)",
                id,
                userId,
                jobId,
                "users/" + userId + "/models/" + jobId + "/a1/mesh.glb",
                createdAt,
                softDeleted ? LocalDateTime.now(ZoneOffset.UTC) : null);
        return id;
    }

    private void newSimulation(String userId, String modelId) {
        jdbc.update(
                "insert into simulation(id, user_id, face_model_id, title, morph_state)"
                        + " values (uuid(), ?, ?, 'it', '{\"schemaVersion\":\"v1\",\"weights\":{}}')",
                userId,
                modelId);
    }

    private int accessLogs(String targetUserId, String targetType) {
        Integer count =
                jdbc.queryForObject(
                        "select count(*) from admin_access_log"
                                + " where target_user_id = ? and target_type = ?",
                        Integer.class,
                        targetUserId,
                        targetType);
        return count == null ? 0 : count;
    }

    private String insertUser(String role) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into user(id, nickname, email, status, role)"
                        + " values (?, '합성', 'synthetic@example.test', 'ACTIVE', ?)",
                id,
                role);
        return id;
    }

    private String bearer(String userId) {
        return "Bearer "
                + jwtProvider.issue(userId, TokenScope.USER, Duration.ofMinutes(5)).value();
    }
}
