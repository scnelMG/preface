package com.preface.api.capture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.preface.TestcontainersConfiguration;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenHashes;
import com.preface.api.global.security.TokenScope;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;

/**
 * QR 연결 → 휴대폰 교환 → 업로드 URL 발급 → 연결 끊기를 실제 MySQL·Redis로 확인한다.
 *
 * <p>S3는 부르지 않는다(presign은 서명만 하므로 네트워크가 필요 없다). 회원·동의는 SQL로 합성 값을 넣는다.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class CaptureFlowIT {

    /** 합성 값: 형식(44자 base64)만 맞춘 임의 체크섬 */
    private static final String CHECKSUM = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbcTemplate;
    @Autowired StringRedisTemplate redis;
    @Autowired JwtProvider jwtProvider;

    private String userId;
    private String pcToken;

    @BeforeEach
    void setUp() {
        userId = newUser(true);
        pcToken = userToken(userId);
    }

    @Test
    void QR로_연결한_휴대폰은_업로드만_할_수_있고_PC가_끊으면_즉시_막힌다() throws Exception {
        MvcResult created =
                mockMvc.perform(post("/api/v1/capture-links").headers(auth(pcToken)))
                        .andExpect(status().isCreated())
                        .andReturn();
        String linkId = JsonPath.read(body(created), "$.data.linkId");
        String qrToken = qrToken(created);
        String linkKey = "capture:link:" + TokenHashes.sha256Hex(qrToken);
        assertThat(redis.getExpire(linkKey)).isBetween(1L, 180L);
        assertThat(redis.hasKey("capture:link:" + qrToken)).as("토큰 원문은 저장하지 않는다").isFalse();
        pollStatus(linkId).andExpect(jsonPath("$.data.status").value("WAITING"));

        String captureToken = exchange(qrToken);
        assertThat(redis.getExpire(linkKey)).isGreaterThan(180L);
        mockMvc.perform(exchangeRequest(qrToken))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("QR_002"));
        pollStatus(linkId).andExpect(jsonPath("$.data.status").value("CONNECTED"));

        // 허용 API
        mockMvc.perform(get("/api/v1/uploads/policy").headers(auth(captureToken)))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "max-age=3600"))
                .andExpect(jsonPath("$.data.video.maxSizeBytes").value(262_144_000))
                .andExpect(jsonPath("$.data.video.maxDurationMs").value(75_000))
                .andExpect(jsonPath("$.data.uploadUrlTtlSec").value(600));
        MvcResult upload =
                mockMvc.perform(
                                uploadRequest(
                                        captureToken, "video/quicktime", 148_000_000L, 35_000))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.data.method").value("PUT"))
                        .andExpect(
                                jsonPath("$.data.headers['x-amz-server-side-encryption']")
                                        .value("AES256"))
                        .andReturn();
        String uploadId = JsonPath.read(body(upload), "$.data.uploadId");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select concat(status, ' ', object_key) from face_upload where id = ?",
                                String.class,
                                uploadId))
                .isEqualTo("ISSUED users/" + userId + "/uploads/" + uploadId + ".mov");

        // 허용 외 API는 AUTH_023
        for (RequestBuilder forbidden :
                new RequestBuilder[] {
                    get("/api/v1/users/me").headers(auth(captureToken)),
                    get("/api/v1/capture-links/" + linkId).headers(auth(captureToken)),
                    post("/api/v1/capture-links").headers(auth(captureToken)),
                    get("/api/v1/reconstructions/current").headers(auth(captureToken))
                }) {
            mockMvc.perform(forbidden)
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error.code").value("AUTH_023"));
        }

        mockMvc.perform(delete("/api/v1/capture-links/" + linkId).headers(auth(pcToken)))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/uploads/policy").headers(auth(captureToken)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("AUTH_023"));
        assertThat(redis.getExpire("capture:revoked:" + linkId)).isBetween(1L, 1800L);
        pollStatus(linkId).andExpect(jsonPath("$.data.status").value("CANCELED"));
    }

    @Test
    void 휴대폰이_스스로_연결을_끊으면_그_세션도_무효가_된다() throws Exception {
        MvcResult created = createLink(pcToken);
        String linkId = JsonPath.read(body(created), "$.data.linkId");
        String captureToken = exchange(qrToken(created));

        mockMvc.perform(delete("/api/v1/capture-links/" + linkId).headers(auth(captureToken)))
                .andExpect(status().isOk());

        mockMvc.perform(uploadRequest(captureToken, "video/mp4", 1_000L, 30_000))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("AUTH_023"));
    }

    @Test
    void 새_QR을_만들면_이전_QR은_EXPIRED가_되어_교환할_수_없다() throws Exception {
        MvcResult first = createLink(pcToken);
        String firstLinkId = JsonPath.read(body(first), "$.data.linkId");
        createLink(pcToken);

        pollStatus(firstLinkId).andExpect(jsonPath("$.data.status").value("EXPIRED"));
        mockMvc.perform(exchangeRequest(qrToken(first)))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.error.code").value("QR_001"));
    }

    @Test
    void 모르는_토큰은_QR_001이고_빈_토큰은_COMMON_001() throws Exception {
        mockMvc.perform(exchangeRequest("unknown-synthetic-token"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.error.code").value("QR_001"));
        mockMvc.perform(exchangeRequest(""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
    }

    @Test
    void 남의_링크는_조회도_끊기도_404() throws Exception {
        String linkId = JsonPath.read(body(createLink(pcToken)), "$.data.linkId");
        String otherToken = userToken(newUser(true));

        mockMvc.perform(get("/api/v1/capture-links/" + linkId).headers(auth(otherToken)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(delete("/api/v1/capture-links/" + linkId).headers(auth(otherToken)))
                .andExpect(status().isNotFound());
    }

    @Test
    void 얼굴_동의가_없으면_CAP_001_진행_중_작업이_있으면_REC_002() throws Exception {
        String noConsent = userToken(newUser(false));
        mockMvc.perform(post("/api/v1/capture-links").headers(auth(noConsent)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("CAP_001"));
        mockMvc.perform(uploadRequest(noConsent, "video/mp4", 1_000L, 30_000))
                .andExpect(jsonPath("$.error.code").value("CAP_001"));

        insertQueuedJob(userId);
        mockMvc.perform(post("/api/v1/capture-links").headers(auth(pcToken)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REC_002"));
        mockMvc.perform(uploadRequest(pcToken, "video/mp4", 1_000L, 30_000))
                .andExpect(jsonPath("$.error.code").value("REC_002"));
    }

    @Test
    void 정책을_어기면_CAP_002와_위반_항목_형식이_틀린_체크섬은_COMMON_001() throws Exception {
        mockMvc.perform(uploadRequest(pcToken, "video/avi", 262_144_001L, 30_000))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("CAP_002"))
                .andExpect(jsonPath("$.error.details[0].field").value("contentType"))
                .andExpect(jsonPath("$.error.details[1].field").value("sizeBytes"));

        mockMvc.perform(
                        post("/api/v1/uploads")
                                .headers(auth(pcToken))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"contentType\":\"video/mp4\",\"sizeBytes\":1000,"
                                                + "\"durationMs\":30000,\"checksumSha256\":\"short\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
    }

    @Test
    void 파일_올리기나_촬영_방식이_없는_업로드는_CAP_002() throws Exception {
        for (String method : new String[] {",\"captureMethod\":\"FILE\"", ""}) {
            mockMvc.perform(
                            post("/api/v1/uploads")
                                    .headers(auth(pcToken))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            "{\"contentType\":\"video/mp4\",\"sizeBytes\":1000,"
                                                    + "\"durationMs\":30000,\"checksumSha256\":\"%s\"%s}"
                                                            .formatted(CHECKSUM, method)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("CAP_002"))
                    .andExpect(jsonPath("$.error.details[0].field").value("captureMethod"));
        }
    }

    private MvcResult createLink(String token) throws Exception {
        return mockMvc.perform(post("/api/v1/capture-links").headers(auth(token)))
                .andExpect(status().isCreated())
                .andReturn();
    }

    private String exchange(String qrToken) throws Exception {
        MvcResult result =
                mockMvc.perform(exchangeRequest(qrToken))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.expiresIn").value(1800))
                        .andExpect(jsonPath("$.data.user.nickname").value("테스트"))
                        .andExpect(jsonPath("$.data.user.maskedEmail").value("t***@example.com"))
                        .andReturn();
        return JsonPath.read(body(result), "$.data.captureSessionToken");
    }

    private ResultActions pollStatus(String linkId) throws Exception {
        return mockMvc.perform(get("/api/v1/capture-links/" + linkId).headers(auth(pcToken)))
                .andExpect(status().isOk());
    }

    private RequestBuilder exchangeRequest(String qrToken) {
        return post("/api/v1/capture-links/exchange")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + qrToken + "\"}");
    }

    private RequestBuilder uploadRequest(
            String token, String contentType, long sizeBytes, int durationMs) {
        return post("/api/v1/uploads")
                .headers(auth(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        ("{\"contentType\":\"%s\",\"sizeBytes\":%d,\"durationMs\":%d,\"checksumSha256\":\"%s\","
                                        + "\"captureMethod\":\"WEB_RECORDER\"}")
                                .formatted(contentType, sizeBytes, durationMs, CHECKSUM));
    }

    private String newUser(boolean faceDataAgreed) {
        String id = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "insert into user(id, nickname, email, status) values (?, '테스트', 'test@example.com', 'ACTIVE')",
                id);
        jdbcTemplate.update(
                "insert into user_consent(id, user_id, consent_document_id, consent_type, agreed, acted_at)"
                        + " select uuid(), ?, id, consent_type, ?, utc_timestamp(3)"
                        + " from consent_document where consent_type = 'FACE_DATA' and effective_at <= utc_timestamp()",
                id,
                faceDataAgreed);
        return id;
    }

    private void insertQueuedJob(String owner) {
        String uploadId = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "insert into face_upload(id, user_id, object_key, content_type, size_bytes, duration_ms,"
                        + " status, url_expires_at, retention_expires_at, checksum_sha256)"
                        + " values (?, ?, 'users/x/uploads/x.mp4', 'video/mp4', 1, 30000, 'UPLOADED',"
                        + " utc_timestamp(), utc_timestamp(), ?)",
                uploadId,
                owner,
                CHECKSUM);
        jdbcTemplate.update(
                "insert into reconstruction_job(id, user_id, face_upload_id, status) values (uuid(), ?, ?, 'QUEUED')",
                owner,
                uploadId);
    }

    private String userToken(String id) {
        return jwtProvider.issue(id, TokenScope.USER, Duration.ofMinutes(30)).value();
    }

    private static String qrToken(MvcResult created) throws Exception {
        String qrUrl = JsonPath.read(body(created), "$.data.qrUrl");
        assertThat(qrUrl).startsWith("http://localhost:3000/m/capture#t=");
        return qrUrl.substring(qrUrl.indexOf("#t=") + 3);
    }

    private static HttpHeaders auth(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        return headers;
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    }
}
