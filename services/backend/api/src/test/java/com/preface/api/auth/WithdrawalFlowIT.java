package com.preface.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.preface.ConsentFixtures;
import com.preface.TestcontainersConfiguration;
import com.preface.api.auth.service.oauth.GoogleOAuthClient;
import com.preface.api.auth.service.oauth.KakaoOAuthClient;
import com.preface.api.auth.service.oauth.OAuthProfile;
import com.preface.api.global.security.AuthProperties;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import com.preface.common.facemodel.entity.CaptureAngle;
import com.preface.common.user.entity.OAuthProvider;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * 내 동의 기록(AUTH-09)·얼굴 동의 철회(AUTH-10)·회원 탈퇴(AUTH-11)를 실제 MySQL·Redis로 확인한다.
 *
 * <p>얼굴 데이터 행은 SQL로 넣은 합성 값이다(S3 key 문자열만 있고 실제 파일은 없다). 카카오 호출만 mock이다.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class WithdrawalFlowIT {

    private static final String REDIRECT = "http://localhost:3000/oauth/kakao";
    private static final String CHECKSUM = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;
    @Autowired AuthProperties authProperties;

    @MockitoBean KakaoOAuthClient kakao;
    @MockitoBean GoogleOAuthClient google;

    private String providerUserId;

    @BeforeEach
    void setUp() {
        providerUserId = "kakao-" + UUID.randomUUID();
        when(kakao.provider()).thenReturn(OAuthProvider.KAKAO);
        when(google.provider()).thenReturn(OAuthProvider.GOOGLE);
        when(kakao.authorizeUrl(anyString(), anyString()))
                .thenAnswer(
                        inv ->
                                "https://kauth.kakao.com/oauth/authorize?state="
                                        + inv.getArgument(1));
        when(kakao.fetchProfile(anyString(), anyString()))
                .thenAnswer(
                        inv ->
                                new OAuthProfile(
                                        OAuthProvider.KAKAO,
                                        providerUserId,
                                        "합성회원",
                                        "synthetic@kakao.test"));
    }

    @Test
    void 탈퇴하면_얼굴_데이터가_DB에서_지워지고_S3_key마다_PENDING_기록이_남고_세션이_모두_끊긴다() throws Exception {
        MvcResult signup = signup();
        String accessToken = JsonPath.read(body(signup), "$.data.accessToken");
        String refreshToken = refreshCookie(signup);
        String userId =
                jdbc.queryForObject(
                        "select user_id from social_account where provider_user_id = ?",
                        String.class,
                        providerUserId);

        // 성공한 3D 1개(사진 5장·시안 1개), 소프트 삭제된 3D 1개, 진행 중 작업 1개
        String doneUpload = newUpload(userId, "UPLOADED");
        String doneJob = newJob(userId, doneUpload, "SUCCEEDED");
        String model = newModel(userId, doneJob, false);
        newCaptureImages(userId, model, doneJob);
        String simulation = newSimulation(userId, model);
        String oldUpload = newUpload(userId, "DELETED");
        String oldJob = newJob(userId, oldUpload, "SUCCEEDED");
        String softDeleted = newModel(userId, oldJob, true);
        String runningUpload = newUpload(userId, "UPLOADED");
        String runningJob = newJob(userId, runningUpload, "RUNNING");
        jdbc.update(
                "insert into notification(id, type, title, user_id) values (uuid(), 'RECON_SUCCEEDED', 't', ?)",
                userId);

        MvcResult withdrawn =
                mockMvc.perform(
                                delete("/api/v1/users/me")
                                        .header(HttpHeaders.AUTHORIZATION, bearer(accessToken)))
                        .andExpect(status().isAccepted())
                        .andExpect(jsonPath("$.data.deletionStatus").value("PENDING"))
                        .andReturn();
        assertThat(withdrawn.getResponse().getHeader(HttpHeaders.SET_COOKIE))
                .as("refresh 쿠키를 만료시킨다")
                .contains("refresh_token=;")
                .contains("Max-Age=0");

        for (String table :
                List.of(
                        "face_upload",
                        "reconstruction_job",
                        "face_model",
                        "face_capture_image",
                        "simulation",
                        "notification",
                        "social_account")) {
            assertThat(countByUser(table, userId)).as(table + " 0건").isZero();
        }
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                simulation))
                .as("시안 하위 이력도 CASCADE로 지워진다")
                .isZero();
        Map<String, Object> user =
                jdbc.queryForMap(
                        "select nickname, email, status, deleted_at from user where id = ?",
                        userId);
        assertThat(user.get("nickname")).isNull();
        assertThat(user.get("email")).isNull();
        assertThat(user.get("status")).isEqualTo("WITHDRAWN");
        assertThat(user.get("deleted_at")).isNotNull();
        assertThat(countByUser("user_consent", userId)).as("동의 증빙은 남긴다").isEqualTo(4);

        String prefix = "users/" + userId + "/models/" + doneJob + "/";
        String oldPrefix = "users/" + userId + "/models/" + oldJob + "/";
        var deletionRows =
                jdbc.query(
                        "select target_type, target_id, object_key, reason, status, retry_count"
                                + " from data_deletion_log where user_id = ?",
                        (rs, n) ->
                                tuple(
                                        rs.getString("target_type"),
                                        rs.getString("target_id"),
                                        rs.getString("object_key"),
                                        rs.getString("reason"),
                                        rs.getString("status"),
                                        rs.getInt("retry_count")),
                        userId);
        assertThat(deletionRows)
                .as("원본 2 + 모델 출력 4 + 사진 5 + 실행 중 시도별 출력 20")
                .hasSize(31)
                .contains(
                        tuple(
                                "FACE_UPLOAD",
                                doneUpload,
                                uploadKey(userId, doneUpload),
                                "WITHDRAWAL",
                                "PENDING",
                                0),
                        tuple(
                                "FACE_UPLOAD",
                                runningUpload,
                                uploadKey(userId, runningUpload),
                                "WITHDRAWAL",
                                "PENDING",
                                0),
                        tuple(
                                "RECON_OUTPUT",
                                model,
                                prefix + "mesh.glb",
                                "WITHDRAWAL",
                                "PENDING",
                                0),
                        tuple(
                                "RECON_OUTPUT",
                                model,
                                prefix + "thumbnail.webp",
                                "WITHDRAWAL",
                                "PENDING",
                                0),
                        tuple(
                                "RECON_OUTPUT",
                                softDeleted,
                                oldPrefix + "mesh.glb",
                                "WITHDRAWAL",
                                "PENDING",
                                0),
                        tuple(
                                "RECON_OUTPUT",
                                softDeleted,
                                oldPrefix + "thumbnail.webp",
                                "WITHDRAWAL",
                                "PENDING",
                                0));
        assertThat(deletionRows)
                .filteredOn(t -> ((String) t.toArray()[2]).startsWith(prefix + "captures/"))
                .extracting(t -> (String) t.toArray()[2])
                .containsExactlyInAnyOrder(
                        prefix + "captures/front.jpg",
                        prefix + "captures/left.jpg",
                        prefix + "captures/right.jpg",
                        prefix + "captures/left_45.jpg",
                        prefix + "captures/right_45.jpg");
        assertThat(deletionRows)
                .filteredOn(t -> runningJob.equals(t.toArray()[1]))
                .as("시도 2번 × (메시·리그·표정 리그·텍스처·썸네일 5 + 사진 5)")
                .hasSize(20)
                .allSatisfy(t -> assertThat(t.toArray()[0]).isEqualTo("RECON_OUTPUT"))
                .extracting(t -> (String) t.toArray()[2])
                .contains(
                        "users/" + userId + "/models/" + runningJob + "/a1/mesh.glb",
                        "users/" + userId + "/models/" + runningJob + "/a1/expression.json",
                        "users/" + userId + "/models/" + runningJob + "/a2/mesh.glb");

        // 세션: access는 바로 거절, refresh는 Redis에서 지워져 재발급 불가
        mockMvc.perform(
                        get("/api/v1/users/me")
                                .header(HttpHeaders.AUTHORIZATION, bearer(accessToken)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_001"));
        mockMvc.perform(
                        get("/api/v1/users/me/consents")
                                .header(HttpHeaders.AUTHORIZATION, bearer(accessToken)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_001"));
        mockMvc.perform(
                        delete("/api/v1/users/me")
                                .header(HttpHeaders.AUTHORIZATION, bearer(accessToken)))
                .andExpect(status().isUnauthorized());
        assertThat(redis.hasKey("auth:refresh-user:" + userId)).isFalse();
        mockMvc.perform(
                        post("/api/v1/auth/token/refresh")
                                .cookie(new Cookie("refresh_token", refreshToken)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_003"));

        // 소셜 계정이 지워졌으니 같은 카카오 계정은 신규 가입으로 간다
        mockMvc.perform(loginRequest(authorizeState()))
                .andExpect(jsonPath("$.data.isNewUser").value(true));
    }

    @Test
    void 얼굴_동의_철회_API는_1차에서_없어_404이고_동의와_얼굴_데이터는_그대로다() throws Exception {
        // 10/26 팀 결정: 가입 후 개별 철회 없음, 동의를 거두려면 탈퇴(S15P31B204-354)
        String userId = newMember();
        String token = tokenFor(userId);
        String queuedJob = newJob(userId, newUpload(userId, "UPLOADED"), "QUEUED");

        mockMvc.perform(
                        delete("/api/v1/users/me/consents/face")
                                .header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));

        assertThat(countByUser("user_consent", userId)).isEqualTo(4);
        assertThat(
                        jdbc.queryForObject(
                                "select status from reconstruction_job where id = ?",
                                String.class,
                                queuedJob))
                .isEqualTo("QUEUED");
        assertThat(countByUser("data_deletion_log", userId)).isZero();
        mockMvc.perform(
                        get("/api/v1/users/me/consents")
                                .header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data[2].consentType").value("FACE_DATA"))
                .andExpect(jsonPath("$.data[2].status").value("AGREED"));
    }

    @Test
    void 동의_기록과_탈퇴는_로그인이_필요하다() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/consents"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_001"));
        mockMvc.perform(delete("/api/v1/users/me/consents/face"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(delete("/api/v1/users/me")).andExpect(status().isUnauthorized());
    }

    // ---- 가입·로그인 ----

    private MvcResult signup() throws Exception {
        MvcResult login =
                mockMvc.perform(loginRequest(authorizeState()))
                        .andExpect(status().isOk())
                        .andReturn();
        String signupToken = JsonPath.read(body(login), "$.data.signupToken");
        StringBuilder consents = new StringBuilder();
        for (String id : jdbc.queryForList(ConsentFixtures.CURRENT_DOCUMENT_IDS, String.class)) {
            if (!consents.isEmpty()) {
                consents.append(',');
            }
            consents.append("{\"consentDocumentId\":\"").append(id).append("\",\"agreed\":true}");
        }
        MvcResult signup =
                mockMvc.perform(
                                post("/api/v1/auth/signup")
                                        .header(HttpHeaders.AUTHORIZATION, bearer(signupToken))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"consents\":[" + consents + "]}"))
                        .andExpect(status().isCreated())
                        .andReturn();
        // 철회·동의 순서가 같은 ms에 겹치지 않도록 동의 시각을 하루 앞으로 당긴다
        jdbc.update(
                "update user_consent c join social_account s on s.user_id = c.user_id"
                        + " set c.acted_at = c.acted_at - interval 1 day where s.provider_user_id = ?",
                providerUserId);
        return signup;
    }

    private String authorizeState() throws Exception {
        MvcResult result =
                mockMvc.perform(
                                get("/api/v1/auth/oauth/kakao/authorize-url")
                                        .param("redirectUri", REDIRECT))
                        .andExpect(status().isOk())
                        .andReturn();
        return JsonPath.read(body(result), "$.data.state");
    }

    private org.springframework.test.web.servlet.RequestBuilder loginRequest(String state) {
        return post("/api/v1/auth/oauth/kakao/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        "{\"code\":\"test-code\",\"state\":\""
                                + state
                                + "\",\"redirectUri\":\""
                                + REDIRECT
                                + "\"}");
    }

    /** SQL로 만든 회원 + 현재 동의서 4종 동의(하루 전). */
    private String newMember() {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into user(id, nickname, email, status) values (?, 'it', 'it@example.test', 'ACTIVE')",
                id);
        jdbc.update(
                "insert into user_consent(id, user_id, consent_document_id, consent_type, agreed, acted_at)"
                        + " select uuid(), ?, d.id, d.consent_type, 1, utc_timestamp(3) - interval 1 day"
                        + " from consent_document d where d.id in ("
                        + ConsentFixtures.CURRENT_DOCUMENT_IDS
                        + ")",
                id);
        return id;
    }

    private String tokenFor(String id) {
        return new JwtProvider(authProperties, Clock.systemUTC())
                .issue(id, TokenScope.USER, Duration.ofMinutes(30))
                .value();
    }

    // ---- 합성 얼굴 데이터 ----

    private String newUpload(String userId, String status) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into face_upload(id, user_id, object_key, content_type, size_bytes, duration_ms,"
                        + " status, url_expires_at, retention_expires_at, checksum_sha256)"
                        + " values (?, ?, ?, 'video/mp4', 1000, 35000, ?,"
                        + " utc_timestamp() + interval 10 minute, utc_timestamp() + interval 1 day, ?)",
                id,
                userId,
                uploadKey(userId, id),
                status,
                CHECKSUM);
        return id;
    }

    private String newJob(String userId, String uploadId, String status) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into reconstruction_job(id, user_id, face_upload_id, status) values (?, ?, ?, ?)",
                id,
                userId,
                uploadId,
                status);
        return id;
    }

    private String newModel(String userId, String jobId, boolean softDeleted) {
        String id = UUID.randomUUID().toString();
        String prefix = "users/" + userId + "/models/" + jobId + "/";
        jdbc.update(
                "insert into face_model(id, user_id, reconstruction_job_id, mesh_object_key,"
                        + " thumbnail_object_key, morph_schema_version, deleted_at)"
                        + " values (?, ?, ?, ?, ?, 'v1', ?)",
                id,
                userId,
                jobId,
                prefix + "mesh.glb",
                prefix + "thumbnail.webp",
                softDeleted ? java.time.LocalDateTime.now(java.time.ZoneOffset.UTC) : null);
        return id;
    }

    private void newCaptureImages(String userId, String modelId, String jobId) {
        for (CaptureAngle angle : CaptureAngle.values()) {
            jdbc.update(
                    "insert into face_capture_image(id, face_model_id, user_id, angle, object_key)"
                            + " values (uuid(), ?, ?, ?, ?)",
                    modelId,
                    userId,
                    angle.name(),
                    "users/" + userId + "/models/" + jobId + "/" + angle.fileName());
        }
    }

    private String newSimulation(String userId, String modelId) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into simulation(id, user_id, face_model_id, title, morph_state)"
                        + " values (?, ?, ?, 'it', '{\"schemaVersion\":\"v1\",\"weights\":{}}')",
                id,
                userId,
                modelId);
        jdbc.update(
                "insert into morph_change(id, simulation_id, seq, source, state_after)"
                        + " values (uuid(), ?, 0, 'INIT', '{}')",
                id);
        return id;
    }

    private int countByUser(String table, String userId) {
        Integer count =
                jdbc.queryForObject(
                        "select count(*) from " + table + " where user_id = ?",
                        Integer.class,
                        userId);
        return count == null ? 0 : count;
    }

    private static String uploadKey(String userId, String uploadId) {
        return "users/" + userId + "/uploads/" + uploadId + ".mp4";
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private static String refreshCookie(MvcResult result) {
        String header = result.getResponse().getHeader(HttpHeaders.SET_COOKIE);
        return header.substring("refresh_token=".length(), header.indexOf(';'));
    }
}
