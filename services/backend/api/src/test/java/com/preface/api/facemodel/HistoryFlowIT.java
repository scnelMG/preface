package com.preface.api.facemodel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.preface.ConsentFixtures;
import com.preface.TestcontainersConfiguration;
import com.preface.api.auth.service.oauth.GoogleOAuthClient;
import com.preface.api.auth.service.oauth.KakaoOAuthClient;
import com.preface.api.auth.service.oauth.OAuthProfile;
import com.preface.api.simulation.service.MorphEdits;
import com.preface.api.simulation.service.NoseEditService;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.user.entity.OAuthProvider;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

/**
 * 내 머리·시안 목록·상세·이름 바꾸기·삭제(API-HIS-01·02·03·05·06·07)를 실제 MySQL로 확인한다.
 *
 * <p>3D(face_model)는 합성 행을 SQL로 넣는다(실제 파일 없음). presign은 네트워크 없이 서명만 하므로 URL 값은 검사·출력하지 않고 있는지만 본다.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class HistoryFlowIT {

    private static final String REDIRECT = "http://localhost:3000/oauth/kakao";

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbcTemplate;

    @MockitoBean KakaoOAuthClient kakao;
    @MockitoBean GoogleOAuthClient google;
    @MockitoBean NoseEditService noseEditService;

    private String providerUserId;

    @BeforeEach
    void setUp() {
        // 합성 얼굴 파일이 없는 이력 테스트에서는 승인·메시 검사를 대체한다.
        when(noseEditService.validate(
                        any(Simulation.class),
                        anyMap(),
                        any(MorphEdits.Applied.class),
                        anyMap(),
                        any(),
                        eq(false)))
                .thenAnswer(inv -> inv.getArgument(2));
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
                                        "테스터",
                                        "tester@example.com"));
    }

    @Test
    void 내_머리_목록은_본인_것만_최신순이고_빈_시안은_개수에서_빠진다() throws Exception {
        Member me = newMember();
        Member other = newMember();
        String older = insertFaceModel(me.userId(), Instant.parse("2026-10-20T00:00:00Z"), false);
        String newer = insertFaceModel(me.userId(), Instant.parse("2026-10-22T00:00:00Z"), true);
        insertFaceModel(other.userId(), Instant.parse("2026-10-23T00:00:00Z"), true);
        String edited = createdSimulationId(me, newer);
        slider(me, edited, 0).andExpect(status().isOk());
        createdSimulationId(me, newer); // 빈 시안

        mockMvc.perform(get("/api/v1/face-models").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items", hasSize(2)))
                .andExpect(jsonPath("$.data.totalElements").value(2))
                .andExpect(jsonPath("$.data.page").value(0))
                .andExpect(jsonPath("$.data.size").value(20))
                .andExpect(jsonPath("$.data.items[0].faceModelId").value(newer))
                .andExpect(jsonPath("$.data.items[0].title").value("내 머리"))
                .andExpect(jsonPath("$.data.items[0].thumbnailUrl").isNotEmpty())
                .andExpect(jsonPath("$.data.items[0].simulationCount").value(1))
                .andExpect(jsonPath("$.data.items[1].faceModelId").value(older))
                .andExpect(jsonPath("$.data.items[1].thumbnailUrl").value(nullValue()))
                .andExpect(jsonPath("$.data.items[1].simulationCount").value(0));
    }

    @Test
    void 내_3D_상세는_presigned_URL과_만료를_주고_남의_3D는_COMMON_002다() throws Exception {
        Member me = newMember();
        Member other = newMember();
        String withTexture = insertFaceModel(me.userId(), Instant.now(), true);
        String withoutTexture = insertFaceModel(me.userId(), Instant.now(), false);

        mockMvc.perform(get("/api/v1/face-models/" + withTexture).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.faceModelId").value(withTexture))
                .andExpect(jsonPath("$.data.meshUrl").isNotEmpty())
                .andExpect(jsonPath("$.data.textureUrl").isNotEmpty())
                .andExpect(jsonPath("$.data.meshFormat").value("GLB"))
                .andExpect(jsonPath("$.data.morphSchemaVersion").value("v1"))
                .andExpect(jsonPath("$.data.urlExpiresAt").isNotEmpty())
                .andExpect(jsonPath("$.data.measurements").doesNotExist());
        mockMvc.perform(get("/api/v1/face-models/" + withoutTexture).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.textureUrl").value(nullValue()));
        mockMvc.perform(get("/api/v1/face-models/" + withTexture).headers(auth(other)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    @Test
    void 시안_목록은_빈_시안을_빼고_이름_바꾸기가_바로_반영된다() throws Exception {
        Member me = newMember();
        Member other = newMember();
        String modelA = insertFaceModel(me.userId(), Instant.now(), false);
        String modelB = insertFaceModel(me.userId(), Instant.now(), false);
        String onA = createdSimulationId(me, modelA);
        slider(me, onA, 0).andExpect(status().isOk());
        String onB = createdSimulationId(me, modelB);
        slider(me, onB, 0).andExpect(status().isOk());
        createdSimulationId(me, modelA); // 빈 시안

        mockMvc.perform(get("/api/v1/simulations").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items", hasSize(2)))
                .andExpect(jsonPath("$.data.totalElements").value(2));
        mockMvc.perform(get("/api/v1/simulations").param("faceModelId", modelA).headers(auth(me)))
                .andExpect(jsonPath("$.data.items", hasSize(1)))
                .andExpect(jsonPath("$.data.items[0].simulationId").value(onA))
                .andExpect(jsonPath("$.data.items[0].faceModelId").value(modelA))
                .andExpect(jsonPath("$.data.items[0].changedParts[0]").value("NOSE"))
                .andExpect(jsonPath("$.data.items[0].changedParts", hasSize(1)))
                .andExpect(jsonPath("$.data.items[0].updatedAt").isNotEmpty());
        mockMvc.perform(get("/api/v1/simulations").headers(auth(other)))
                .andExpect(jsonPath("$.data.items", hasSize(0)));

        rename(me, onA, "  콧대를 조금 높인 시안 ")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.simulationId").value(onA))
                .andExpect(jsonPath("$.data.title").value("콧대를 조금 높인 시안"))
                .andExpect(jsonPath("$.data.updatedAt").isNotEmpty());
        mockMvc.perform(get("/api/v1/simulations/" + onA).headers(auth(me)))
                .andExpect(jsonPath("$.data.title").value("콧대를 조금 높인 시안"))
                .andExpect(jsonPath("$.data.stateVersion").value(1));
        mockMvc.perform(get("/api/v1/simulations").param("faceModelId", modelA).headers(auth(me)))
                .andExpect(jsonPath("$.data.items[0].title").value("콧대를 조금 높인 시안"));

        rename(me, onA, "   ")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
        rename(me, onA, "가".repeat(101))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
        rename(other, onA, "남의 시안")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    @Test
    void 변경_있는_시안은_소프트_삭제_빈_시안은_물리_삭제되고_바로_조회에서_빠진다() throws Exception {
        Member me = newMember();
        Member other = newMember();
        String model = insertFaceModel(me.userId(), Instant.now(), false);
        String changed = createdSimulationId(me, model);
        slider(me, changed, 0).andExpect(status().isOk());
        String empty = createdSimulationId(me, model);

        mockMvc.perform(delete("/api/v1/simulations/" + changed).headers(auth(other)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));

        mockMvc.perform(delete("/api/v1/simulations/" + changed).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isMap())
                .andExpect(jsonPath("$.data").isEmpty());
        mockMvc.perform(delete("/api/v1/simulations/" + empty).headers(auth(me)))
                .andExpect(status().isOk());

        assertThat(
                        jdbcTemplate.queryForObject(
                                "select deleted_at is not null from simulation where id = ?",
                                Boolean.class,
                                changed))
                .as("변경 있는 시안은 행이 남고 deleted_at이 찍힌다")
                .isTrue();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from simulation where id = ?",
                                Integer.class,
                                empty))
                .as("빈 시안은 바로 지워진다")
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                empty))
                .isZero();

        mockMvc.perform(get("/api/v1/simulations/" + changed).headers(auth(me)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(get("/api/v1/simulations").headers(auth(me)))
                .andExpect(jsonPath("$.data.items", hasSize(0)));
        mockMvc.perform(get("/api/v1/face-models").headers(auth(me)))
                .andExpect(jsonPath("$.data.items[0].simulationCount").value(0));
        slider(me, changed, 1)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(delete("/api/v1/simulations/" + changed).headers(auth(me)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    @Test
    void 내_3D를_지우면_연결_시안도_함께_소프트_삭제되고_목록_상세에서_빠진다() throws Exception {
        Member me = newMember();
        Member other = newMember();
        String model = insertFaceModel(me.userId(), Instant.now(), true);
        String kept = insertFaceModel(me.userId(), Instant.now(), false);
        String changed = createdSimulationId(me, model);
        slider(me, changed, 0).andExpect(status().isOk());
        String empty = createdSimulationId(me, model);
        String onKept = createdSimulationId(me, kept);
        slider(me, onKept, 0).andExpect(status().isOk());

        mockMvc.perform(delete("/api/v1/face-models/" + model).headers(auth(other)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));

        mockMvc.perform(delete("/api/v1/face-models/" + model).headers(auth(me)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.deletionStatus").value("PENDING"));

        assertThat(
                        jdbcTemplate.queryForObject(
                                "select deleted_at is not null from face_model where id = ?",
                                Boolean.class,
                                model))
                .isTrue();
        assertThat(
                        jdbcTemplate.queryForList(
                                "select id from simulation where face_model_id = ?"
                                        + " and deleted_at is not null",
                                String.class,
                                model))
                .as("빈 시안까지 연결 시안 모두 삭제 표시")
                .containsExactlyInAnyOrder(changed, empty);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select deleted_at is null from simulation where id = ?",
                                Boolean.class,
                                onKept))
                .as("다른 3D의 시안은 그대로")
                .isTrue();

        mockMvc.perform(get("/api/v1/face-models/" + model).headers(auth(me)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(get("/api/v1/face-models").headers(auth(me)))
                .andExpect(jsonPath("$.data.items", hasSize(1)))
                .andExpect(jsonPath("$.data.items[0].faceModelId").value(kept));
        mockMvc.perform(get("/api/v1/simulations/" + changed).headers(auth(me)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(get("/api/v1/simulations").headers(auth(me)))
                .andExpect(jsonPath("$.data.items", hasSize(1)))
                .andExpect(jsonPath("$.data.items[0].simulationId").value(onKept));
        mockMvc.perform(createSimulation(me, model))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("HIS_002"));
        mockMvc.perform(delete("/api/v1/face-models/" + model).headers(auth(me)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    @Test
    void 내_머리_이름을_바꾸면_목록에_바로_반영되고_남의_것_빈_이름_삭제된_것은_거절된다() throws Exception {
        Member me = newMember();
        Member other = newMember();
        String model = insertFaceModel(me.userId(), Instant.now(), true);

        renameModel(me, model, "  여름 머리  ")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.faceModelId").value(model))
                .andExpect(jsonPath("$.data.title").value("여름 머리"))
                .andExpect(jsonPath("$.data.updatedAt").isNotEmpty());
        mockMvc.perform(get("/api/v1/face-models").headers(auth(me)))
                .andExpect(jsonPath("$.data.items[0].title").value("여름 머리"));

        renameModel(other, model, "남의 머리")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        renameModel(me, model, "가".repeat(20)).andExpect(status().isOk());
        renameModel(me, model, "   ")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
        renameModel(me, model, "가".repeat(21))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));

        mockMvc.perform(delete("/api/v1/face-models/" + model).headers(auth(me)))
                .andExpect(status().isAccepted());
        renameModel(me, model, "지운 머리")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    @Test
    void 내_3D의_정면_사진은_presigned_URL로_받고_남의_것_삭제된_것_사진_없는_것은_COMMON_002다() throws Exception {
        Member me = newMember();
        Member other = newMember();
        String withPhoto = insertFaceModel(me.userId(), Instant.now(), true);
        String noPhoto = insertFaceModel(me.userId(), Instant.now(), true);
        jdbcTemplate.update(
                "insert into face_capture_image(id, face_model_id, user_id, angle, object_key)"
                        + " values (?, ?, ?, 'FRONT', ?)",
                UUID.randomUUID().toString(),
                withPhoto,
                me.userId(),
                "users/" + me.userId() + "/models/x/captures/front.jpg");
        String photo = "/api/v1/face-models/" + withPhoto + "/front-photo";

        mockMvc.perform(get(photo).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.url").isNotEmpty())
                .andExpect(jsonPath("$.data.expiresAt").isNotEmpty());
        mockMvc.perform(get(photo).headers(auth(other)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(get("/api/v1/face-models/" + noPhoto + "/front-photo").headers(auth(me)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));

        mockMvc.perform(delete("/api/v1/face-models/" + withPhoto).headers(auth(me)))
                .andExpect(status().isAccepted());
        mockMvc.perform(get(photo).headers(auth(me)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    @Test
    void 로그인하지_않으면_이력_API는_AUTH_001이다() throws Exception {
        mockMvc.perform(get("/api/v1/face-models"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_001"));
        mockMvc.perform(get("/api/v1/simulations"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_001"));
    }

    // ---- 도우미 (SimulationEditIT와 같은 방식) ----

    private record Member(String userId, String accessToken) {}

    /** 소셜 로그인 → 동의 4종 가입으로 새 회원과 access token을 만든다. */
    private Member newMember() throws Exception {
        providerUserId = "kakao-" + UUID.randomUUID();
        MvcResult authorize =
                mockMvc.perform(
                                get("/api/v1/auth/oauth/kakao/authorize-url")
                                        .param("redirectUri", REDIRECT))
                        .andReturn();
        String state = JsonPath.read(body(authorize), "$.data.state");
        MvcResult login =
                mockMvc.perform(
                                post("/api/v1/auth/oauth/kakao/login")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"code\":\"test-code\",\"state\":\""
                                                        + state
                                                        + "\",\"redirectUri\":\""
                                                        + REDIRECT
                                                        + "\"}"))
                        .andReturn();
        String signupToken = JsonPath.read(body(login), "$.data.signupToken");

        StringBuilder consents = new StringBuilder();
        for (String docId :
                jdbcTemplate.queryForList(ConsentFixtures.CURRENT_DOCUMENT_IDS, String.class)) {
            if (!consents.isEmpty()) {
                consents.append(',');
            }
            consents.append("{\"consentDocumentId\":\"")
                    .append(docId)
                    .append("\",\"agreed\":true}");
        }
        MvcResult signup =
                mockMvc.perform(
                                post("/api/v1/auth/signup")
                                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + signupToken)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"consents\":[" + consents + "]}"))
                        .andExpect(status().isCreated())
                        .andReturn();
        return new Member(
                JsonPath.read(body(signup), "$.data.user.id"),
                JsonPath.read(body(signup), "$.data.accessToken"));
    }

    /** 합성 3D 한 개(업로드·성공한 복원 작업·모델 행). 실제 파일은 없다. */
    private String insertFaceModel(String userId, Instant createdAt, boolean withExtras) {
        String uploadId = UUID.randomUUID().toString();
        String jobId = UUID.randomUUID().toString();
        String faceModelId = UUID.randomUUID().toString();
        Timestamp now = Timestamp.from(Instant.now());
        String prefix = "users/" + userId + "/models/" + jobId + "/";
        jdbcTemplate.update(
                "insert into face_upload(id, user_id, object_key, content_type, size_bytes,"
                        + " duration_ms, status, url_expires_at, retention_expires_at,"
                        + " checksum_sha256) values (?, ?, ?, 'video/mp4', 1000, 30000,"
                        + " 'UPLOADED', ?, ?, ?)",
                uploadId,
                userId,
                "users/" + userId + "/uploads/" + uploadId + ".mp4",
                now,
                now,
                "A".repeat(44));
        jdbcTemplate.update(
                "insert into reconstruction_job(id, user_id, face_upload_id, status)"
                        + " values (?, ?, ?, 'SUCCEEDED')",
                jobId,
                userId,
                uploadId);
        jdbcTemplate.update(
                "insert into face_model(id, user_id, reconstruction_job_id, mesh_object_key,"
                        + " texture_object_key, thumbnail_object_key, morph_schema_version,"
                        + " created_at) values (?, ?, ?, ?, ?, ?, 'v1', ?)",
                faceModelId,
                userId,
                jobId,
                prefix + "mesh.glb",
                withExtras ? prefix + "texture.png" : null,
                withExtras ? prefix + "thumbnail.png" : null,
                Timestamp.from(createdAt));
        return faceModelId;
    }

    private String createdSimulationId(Member member, String faceModelId) throws Exception {
        MvcResult result =
                mockMvc.perform(createSimulation(member, faceModelId))
                        .andExpect(status().isCreated())
                        .andReturn();
        return JsonPath.read(body(result), "$.data.simulationId");
    }

    private org.springframework.test.web.servlet.RequestBuilder createSimulation(
            Member member, String faceModelId) {
        return post("/api/v1/face-models/" + faceModelId + "/simulations")
                .headers(auth(member))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}");
    }

    /** 콧대 높이 0.2 한 번(= 변경 있는 시안). */
    private ResultActions slider(Member member, String simulationId, int stateVersion)
            throws Exception {
        return mockMvc.perform(
                patch("/api/v1/simulations/" + simulationId + "/morph-state")
                        .headers(auth(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                "{\"stateVersion\":"
                                        + stateVersion
                                        + ",\"changes\":[{\"code\":\"nose.bridge_height\","
                                        + "\"value\":0.2}]}"));
    }

    private ResultActions rename(Member member, String simulationId, String title)
            throws Exception {
        return mockMvc.perform(
                patch("/api/v1/simulations/" + simulationId)
                        .headers(auth(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"" + title + "\"}"));
    }

    private ResultActions renameModel(Member member, String faceModelId, String title)
            throws Exception {
        return mockMvc.perform(
                patch("/api/v1/face-models/" + faceModelId)
                        .headers(auth(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"" + title + "\"}"));
    }

    private static HttpHeaders auth(Member member) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(member.accessToken());
        return headers;
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    }
}
