package com.preface.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.preface.TestcontainersConfiguration;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import java.time.Duration;
import java.time.LocalDateTime;
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
import org.springframework.test.web.servlet.MockMvc;

/**
 * 관리자 회원 목록·검색(S15P31B204-707)을 실제 MySQL로 확인한다. 회원·닉네임은 합성 값이다. 다른 테스트의 회원과 섞이지 않게 닉네임에 테스트마다 다른
 * 표식을 넣는다.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AdminUserSearchIT {

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtProvider jwtProvider;

    @Test
    void 일반_회원은_403_ADM_001이다() throws Exception {
        String user = insertUser("USER", "합성", LocalDateTime.of(2026, 1, 1, 0, 0));

        mockMvc.perform(get("/api/v1/admin/users").header(HttpHeaders.AUTHORIZATION, bearer(user)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("ADM_001"));
    }

    @Test
    void UUID로_탈퇴_회원도_찾고_그_회원을_대상으로_USER_기록을_남긴다() throws Exception {
        String admin = insertUser("ADMIN", "합성", LocalDateTime.of(2026, 1, 1, 0, 0));
        String user = insertUser("USER", null, LocalDateTime.of(2026, 1, 2, 0, 0));
        jdbc.update(
                "update user set status = 'WITHDRAWN', email = null,"
                        + " deleted_at = utc_timestamp() where id = ?",
                user);

        mockMvc.perform(
                        get("/api/v1/admin/users")
                                .param("q", " " + user.toUpperCase() + " ")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.items[0].userId").value(user))
                .andExpect(jsonPath("$.data.items[0].nickname").value(nullValue()))
                .andExpect(jsonPath("$.data.items[0].status").value("WITHDRAWN"))
                .andExpect(jsonPath("$.data.items[0].deletedAt").isNotEmpty())
                .andExpect(jsonPath("$.data.items[0].email").doesNotExist());

        Integer logs =
                jdbc.queryForObject(
                        "select count(*) from admin_access_log where admin_user_id = ?"
                                + " and target_type = 'USER' and target_user_id = ? and target_id = ?",
                        Integer.class,
                        admin,
                        user,
                        user);
        assertThat(logs).isEqualTo(1);
    }

    @Test
    void 이름_검색은_대소문자를_무시하고_밑줄을_글자로_보며_집계를_붙여_최신순으로_준다() throws Exception {
        String admin = insertUser("ADMIN", "합성", LocalDateTime.of(2026, 1, 1, 0, 0));
        String tag = UUID.randomUUID().toString().substring(0, 8);
        String older = insertUser("USER", "It" + tag + "_X", LocalDateTime.of(2026, 3, 1, 0, 0));
        String newer = insertUser("USER", "it" + tag + "_x", LocalDateTime.of(2026, 3, 2, 0, 0));
        insertUser("USER", "it" + tag + "ax", LocalDateTime.of(2026, 3, 3, 0, 0));
        social(newer, "KAKAO");
        social(newer, "GOOGLE");
        String job = newJob(newer);
        newModel(newer, job, false);
        newModel(newer, newJob(newer), true);

        mockMvc.perform(
                        get("/api/v1/admin/users")
                                .param("q", "IT" + tag + "_x")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2))
                .andExpect(jsonPath("$.data.totalPages").value(1))
                .andExpect(jsonPath("$.data.size").value(20))
                .andExpect(jsonPath("$.data.items[0].userId").value(newer))
                .andExpect(jsonPath("$.data.items[0].providers[0]").value("GOOGLE"))
                .andExpect(jsonPath("$.data.items[0].providers[1]").value("KAKAO"))
                .andExpect(jsonPath("$.data.items[0].faceModelCount").value(2))
                .andExpect(jsonPath("$.data.items[0].lastJobAt").isNotEmpty())
                .andExpect(jsonPath("$.data.items[0].role").value("USER"))
                .andExpect(jsonPath("$.data.items[0].email").doesNotExist())
                .andExpect(jsonPath("$.data.items[0].mattermostUsername").doesNotExist())
                .andExpect(jsonPath("$.data.items[1].userId").value(older))
                .andExpect(jsonPath("$.data.items[1].providers").isEmpty())
                .andExpect(jsonPath("$.data.items[1].faceModelCount").value(0))
                .andExpect(jsonPath("$.data.items[1].lastJobAt").value(nullValue()));

        Integer logs =
                jdbc.queryForObject(
                        "select count(*) from admin_access_log where admin_user_id = ?"
                                + " and target_type = 'USER' and target_user_id is null"
                                + " and target_id is null and request_path = '/api/v1/admin/users'",
                        Integer.class,
                        admin);
        assertThat(logs).isEqualTo(1);
    }

    @Test
    void 쪽_나누기와_잘못된_요청() throws Exception {
        String admin = insertUser("ADMIN", "합성", LocalDateTime.of(2026, 1, 1, 0, 0));
        String tag = UUID.randomUUID().toString().substring(0, 8);
        insertUser("USER", "pg" + tag + "1", LocalDateTime.of(2026, 4, 1, 0, 0));
        insertUser("USER", "pg" + tag + "2", LocalDateTime.of(2026, 4, 2, 0, 0));
        String oldest = insertUser("USER", "pg" + tag + "0", LocalDateTime.of(2026, 3, 31, 0, 0));

        mockMvc.perform(
                        get("/api/v1/admin/users")
                                .param("q", "pg" + tag)
                                .param("page", "1")
                                .param("size", "2")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.page").value(1))
                .andExpect(jsonPath("$.data.size").value(2))
                .andExpect(jsonPath("$.data.totalElements").value(3))
                .andExpect(jsonPath("$.data.totalPages").value(2))
                .andExpect(jsonPath("$.data.items.length()").value(1))
                .andExpect(jsonPath("$.data.items[0].userId").value(oldest));

        mockMvc.perform(
                        get("/api/v1/admin/users")
                                .param("q", "가".repeat(51))
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));

        mockMvc.perform(
                        get("/api/v1/admin/users")
                                .param("page", "-1")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));

        mockMvc.perform(get("/api/v1/admin/users").header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.page").value(0))
                .andExpect(jsonPath("$.data.size").value(20));
    }

    @Test
    void V29_뒤로_조회_기록_대상_종류에_USER를_넣을_수_있다() {
        int inserted =
                jdbc.update(
                        "insert into admin_access_log(id, admin_user_id, target_user_id, target_type,"
                                + " target_id, request_path, accessed_at)"
                                + " values (uuid(), ?, null, 'USER', null, '/api/v1/admin/users',"
                                + " utc_timestamp(3))",
                        "00000000-0000-0000-0000-00000000000a");

        assertThat(inserted).isEqualTo(1);
    }

    // ---- 합성 데이터 ----

    private void social(String userId, String provider) {
        jdbc.update(
                "insert into social_account(id, user_id, provider, provider_user_id)"
                        + " values (uuid(), ?, ?, ?)",
                userId,
                provider,
                "it-" + UUID.randomUUID());
    }

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

    private void newModel(String userId, String jobId, boolean softDeleted) {
        jdbc.update(
                "insert into face_model(id, user_id, reconstruction_job_id, mesh_object_key,"
                        + " morph_schema_version, deleted_at) values (uuid(), ?, ?, ?, 'v1', ?)",
                userId,
                jobId,
                "users/" + userId + "/models/" + jobId + "/a1/mesh.glb",
                softDeleted ? LocalDateTime.of(2026, 5, 1, 0, 0) : null);
    }

    private String insertUser(String role, String nickname, LocalDateTime createdAt) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into user(id, nickname, email, status, role, created_at)"
                        + " values (?, ?, 'synthetic@example.test', 'ACTIVE', ?, ?)",
                id,
                nickname,
                role,
                createdAt);
        return id;
    }

    private String bearer(String userId) {
        return "Bearer "
                + jwtProvider.issue(userId, TokenScope.USER, Duration.ofMinutes(5)).value();
    }
}
