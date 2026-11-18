package com.preface.api.share;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.preface.TestcontainersConfiguration;
import com.preface.api.share.service.ShareToken;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** 시안 공유(S15P31B204-574)를 실제 MySQL로 확인한다. 데이터는 합성 행을 SQL로 넣는다. */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class SimulationShareIT {

    static final String STATE =
            "{\"schemaVersion\":\"v1\",\"weights\":{\"nose.bridge_height\":0.3}}";

    @Autowired JdbcTemplate jdbcTemplate;
    @Autowired MockMvc mockMvc;

    @Test
    void 로그인_없이_공유를_볼_수_있고_다른_공유_API는_401이다() throws Exception {
        Fixture f = fixture();
        agreeFacePublic(f.userId());
        String token = ShareToken.generate();
        insertShare(f, ShareToken.hash(token));

        mockMvc.perform(get("/api/v1/shares/" + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.meshUrl").isNotEmpty())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.3));
        mockMvc.perform(get("/api/v1/simulations/" + f.simulationId() + "/shares"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/simulations/" + f.simulationId() + "/shares"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(delete("/api/v1/shares/" + UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void 공개_응답에_사용자_정보가_없다() throws Exception {
        Fixture f = fixture();
        agreeFacePublic(f.userId());
        String token = ShareToken.generate();
        insertShare(f, ShareToken.hash(token));

        mockMvc.perform(get("/api/v1/shares/" + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userId").doesNotExist())
                .andExpect(jsonPath("$.data.simulationId").doesNotExist())
                .andExpect(jsonPath("$.data.faceModelId").doesNotExist())
                .andExpect(jsonPath("$.data.title").doesNotExist())
                .andExpect(jsonPath("$.data.nickname").doesNotExist())
                .andExpect(jsonPath("$.data.senderName").value(nullValue()));
    }

    @Test
    void 공유한_사람이_적은_이름만_공개_응답에_담긴다() throws Exception {
        Fixture f = fixture();
        agreeFacePublic(f.userId());
        String token = ShareToken.generate();
        String shareId = insertShare(f, ShareToken.hash(token));
        jdbcTemplate.update(
                "update simulation_share set sender_name = '민트초코' where id = ?", shareId);

        mockMvc.perform(get("/api/v1/shares/" + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.senderName").value("민트초코"))
                .andExpect(jsonPath("$.data.nickname").doesNotExist());
    }

    @Test
    void 공개_응답은_캐시하지_않고_색인하지_않는다() throws Exception {
        Fixture f = fixture();
        agreeFacePublic(f.userId());
        String token = ShareToken.generate();
        insertShare(f, ShareToken.hash(token));

        mockMvc.perform(get("/api/v1/shares/" + token))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Robots-Tag", "noindex"));
    }

    @Test
    void 공유를_끝내면_같은_링크가_SHR_001이다() throws Exception {
        Fixture f = fixture();
        agreeFacePublic(f.userId());
        String token = ShareToken.generate();
        String shareId = insertShare(f, ShareToken.hash(token));
        jdbcTemplate.update(
                "update simulation_share set revoked_at = utc_timestamp(3) where id = ?", shareId);

        mockMvc.perform(get("/api/v1/shares/" + token))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("SHR_001"));
    }

    @Test
    void 시안을_물리_삭제하면_공유도_함께_지워진다() {
        Fixture f = fixture();
        String shareId = insertShare(f, "B".repeat(44));

        jdbcTemplate.update("delete from simulation where id = ?", f.simulationId());

        assertThat(count("select count(*) from simulation_share where id = ?", shareId)).isZero();
    }

    @Test
    void 같은_토큰_해시는_두_번_저장할_수_없다() {
        Fixture f = fixture();
        String hash =
                UUID.randomUUID().toString().replace("-", "").substring(0, 32) + "C".repeat(12);
        insertShare(f, hash);

        assertThatThrownBy(() -> insertShare(f, hash))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    record Fixture(String userId, String faceModelId, String simulationId) {}

    /** 합성 회원·3D·시안 한 벌. 실제 파일은 없다. */
    Fixture fixture() {
        String userId = UUID.randomUUID().toString();
        String uploadId = UUID.randomUUID().toString();
        String jobId = UUID.randomUUID().toString();
        String faceModelId = UUID.randomUUID().toString();
        String simulationId = UUID.randomUUID().toString();
        Timestamp now = Timestamp.from(Instant.now());
        jdbcTemplate.update("insert into user(id, nickname) values (?, '테스터')", userId);
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
                        + " morph_schema_version) values (?, ?, ?, ?, 'v1')",
                faceModelId,
                userId,
                jobId,
                "users/" + userId + "/models/" + jobId + "/mesh.glb");
        jdbcTemplate.update(
                "insert into simulation(id, user_id, face_model_id, title, morph_state,"
                        + " has_changes) values (?, ?, ?, '시안', ?, 1)",
                simulationId,
                userId,
                faceModelId,
                STATE);
        return new Fixture(userId, faceModelId, simulationId);
    }

    String insertShare(Fixture f, String tokenHash) {
        String id = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "insert into simulation_share(id, user_id, simulation_id, face_model_id,"
                        + " token_hash, morph_state, expires_at, created_at)"
                        + " values (?, ?, ?, ?, ?, ?, ?, ?)",
                id,
                f.userId(),
                f.simulationId(),
                f.faceModelId(),
                tokenHash,
                STATE,
                Timestamp.from(Instant.now().plus(7, ChronoUnit.DAYS)),
                Timestamp.from(Instant.now()));
        return id;
    }

    /** 시행 중인 FACE_PUBLIC 동의서에 동의한 기록. 최소 버전은 기본값(가입 때 받는 v1 2026-10-v1)을 그대로 쓴다. */
    void agreeFacePublic(String userId) {
        jdbcTemplate.update(
                "insert into user_consent(id, user_id, consent_document_id, consent_type, agreed,"
                        + " acted_at) select uuid(), ?, d.id, d.consent_type, 1, utc_timestamp(3)"
                        + " from consent_document d where d.consent_type = 'FACE_PUBLIC'"
                        + " and d.effective_at <= utc_timestamp() order by d.effective_at desc"
                        + " limit 1",
                userId);
    }

    int count(String sql, Object... args) {
        Integer n = jdbcTemplate.queryForObject(sql, Integer.class, args);
        return n == null ? 0 : n;
    }
}
