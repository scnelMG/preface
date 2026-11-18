package com.preface.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.preface.TestcontainersConfiguration;
import com.preface.api.admin.service.AdminAccessLogger;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import com.preface.common.admin.entity.AdminAccessTargetType;
import java.time.Duration;
import java.util.Map;
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

/** 관리자 권한(GET /api/v1/admin/me)과 조회 기록(V27)을 실제 MySQL로 확인한다(S15P31B204-651). 회원은 합성 행이다. */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AdminApiIT {

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtProvider jwtProvider;
    @Autowired AdminAccessLogger accessLogger;

    @Test
    void 로그인하지_않으면_기존처럼_AUTH_001이다() throws Exception {
        mockMvc.perform(get("/api/v1/admin/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_001"));
    }

    @Test
    void 일반_회원은_403_ADM_001이다() throws Exception {
        String user = insertUser("USER");

        mockMvc.perform(get("/api/v1/admin/me").header(HttpHeaders.AUTHORIZATION, bearer(user)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("ADM_001"));
    }

    @Test
    void 관리자는_본인_ID와_환경을_받는다() throws Exception {
        String admin = insertUser("ADMIN");

        mockMvc.perform(get("/api/v1/admin/me").header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userId").value(admin))
                .andExpect(jsonPath("$.data.role").value("ADMIN"))
                .andExpect(jsonPath("$.data.environment").value("local"));
    }

    @Test
    void DB에서_권한을_바꾸면_같은_토큰의_다음_요청부터_반영된다() throws Exception {
        String user = insertUser("USER");
        String token = bearer(user);
        mockMvc.perform(get("/api/v1/admin/me").header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isForbidden());

        jdbc.update("update user set role = 'ADMIN' where id = ?", user);
        mockMvc.perform(get("/api/v1/admin/me").header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk());

        jdbc.update("update user set role = 'USER' where id = ?", user);
        mockMvc.perform(get("/api/v1/admin/me").header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("ADM_001"));
    }

    @Test
    void 탈퇴한_관리자는_ADMIN이어도_통과하지_못한다() throws Exception {
        String admin = insertUser("ADMIN");
        jdbc.update(
                "update user set status = 'WITHDRAWN', deleted_at = now(3) where id = ?", admin);

        mockMvc.perform(get("/api/v1/admin/me").header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("ADM_001"));
    }

    @Test
    void 조회_기록이_남고_관리자_회원이_지워져도_기록은_남는다() {
        String admin = insertUser("ADMIN");
        String target = insertUser("USER");
        String jobId = UUID.randomUUID().toString();

        accessLogger.record(
                admin,
                target,
                AdminAccessTargetType.JOB,
                jobId,
                "/api/v1/admin/reconstructions/" + jobId + "?x=1");

        Map<String, Object> row =
                jdbc.queryForMap(
                        "select admin_user_id, target_user_id, target_type, target_id, request_path"
                                + " from admin_access_log where target_user_id = ?",
                        target);
        assertThat(row)
                .containsEntry("admin_user_id", admin)
                .containsEntry("target_type", "JOB")
                .containsEntry("target_id", jobId)
                .containsEntry("request_path", "/api/v1/admin/reconstructions/" + jobId);

        // 탈퇴 뒤 보관 기간이 끝난 회원 행 삭제(RetentionSweeper)가 조회 기록 때문에 막히지 않는다
        jdbc.update("delete from user where id = ?", admin);
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from admin_access_log where admin_user_id = ?",
                                Integer.class,
                                admin))
                .isEqualTo(1);
    }

    @Test
    void 권한과_조회_기록_대상에는_정해진_값만_들어간다() {
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "insert into user(id, status, role) values (uuid(), 'ACTIVE', 'ROOT')"))
                .hasMessageContaining("ck_user_role");
        assertThatThrownBy(
                        () ->
                                jdbc.update(
                                        "insert into admin_access_log(id, admin_user_id, target_type,"
                                                + " request_path, accessed_at)"
                                                + " values (uuid(), uuid(), 'EVERYTHING', '/', now(3))"))
                .hasMessageContaining("ck_admin_access_log_target_type");
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
