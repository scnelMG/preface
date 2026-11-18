package com.preface.api.facereading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.preface.TestcontainersConfiguration;
import com.preface.api.facereading.service.FaceReadingEngine;
import com.preface.api.facereading.service.FaceReadingFailure;
import com.preface.api.facereading.service.FrontFrameSource;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
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
import org.springframework.test.web.servlet.MvcResult;

/** AI 관상 API 흐름(S15P31B204-438). 사진 꺼내기(S3)와 GMS는 mock으로 바꾸고, 요청 → 비동기 처리 → 조회와 DB 상태를 본다. */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class FaceReadingFlowIT {

    private static final String RESULT = "{\"title\":\"복이 쌓이는 관상\"}";

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbcTemplate;
    @Autowired JwtProvider jwtProvider;

    @MockitoBean FrontFrameSource frames;
    @MockitoBean FaceReadingEngine engine;

    @Test
    void 추출이_끝난_작업은_관상을_만들고_다시_요청해도_GMS를_다시_부르지_않는다() throws Exception {
        String userId = newUser();
        String jobId = newJob(userId, true, "users/x/uploads/y/frames-a1.tar");
        when(frames.frontJpeg("users/x/uploads/y/frames-a1.tar")).thenReturn(new byte[] {1});
        when(engine.read(any())).thenReturn(new FaceReadingEngine.Reading(RESULT, "gpt-test"));

        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/reconstructions/" + jobId + "/face-reading")
                                        .headers(auth(userId)))
                        .andExpect(status().isAccepted())
                        .andExpect(jsonPath("$.data.status").value("PENDING"))
                        .andReturn();
        String readingId = JsonPath.read(body(created), "$.data.readingId");

        awaitStatus(userId, readingId, "DONE");
        mockMvc.perform(
                        get("/api/v1/reconstructions/" + jobId + "/face-reading")
                                .headers(auth(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.readingId").value(readingId))
                .andExpect(jsonPath("$.data.result.title").value("복이 쌓이는 관상"));

        mockMvc.perform(
                        post("/api/v1/reconstructions/" + jobId + "/face-reading")
                                .headers(auth(userId)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.readingId").value(readingId))
                .andExpect(jsonPath("$.data.status").value("DONE"));
        verify(engine, times(1)).read(any());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select model from face_reading where id = ?",
                                String.class,
                                readingId))
                .isEqualTo("gpt-test");
    }

    @Test
    void 실패하면_FAILED로_남고_다시_요청하면_같은_행으로_다시_만든다() throws Exception {
        String userId = newUser();
        String jobId = newJob(userId, true, "users/x/uploads/z/frames-a1.tar");
        when(frames.frontJpeg(anyString()))
                .thenThrow(new FaceReadingFailure(FaceReadingFailure.NO_FRONT, "test"))
                .thenReturn(new byte[] {1});
        when(engine.read(any())).thenReturn(new FaceReadingEngine.Reading(RESULT, "gpt-test"));

        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/reconstructions/" + jobId + "/face-reading")
                                        .headers(auth(userId)))
                        .andReturn();
        String readingId = JsonPath.read(body(created), "$.data.readingId");
        awaitStatus(userId, readingId, "FAILED");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select fail_code from face_reading where id = ?",
                                String.class,
                                readingId))
                .isEqualTo("NO_FRONT");

        mockMvc.perform(
                        post("/api/v1/reconstructions/" + jobId + "/face-reading")
                                .headers(auth(userId)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.readingId").value(readingId));
        awaitStatus(userId, readingId, "DONE");
    }

    @Test
    void 추출_전이면_READ_001_묶음이_지워졌으면_READ_002_남의_작업이면_COMMON_002다() throws Exception {
        String userId = newUser();
        String waiting = newJob(userId, false, null);
        mockMvc.perform(
                        post("/api/v1/reconstructions/" + waiting + "/face-reading")
                                .headers(auth(userId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("READ_001"));

        String finished = newJob(userId, true, null);
        mockMvc.perform(
                        post("/api/v1/reconstructions/" + finished + "/face-reading")
                                .headers(auth(userId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("READ_002"));

        String other = newUser();
        mockMvc.perform(
                        post("/api/v1/reconstructions/" + waiting + "/face-reading")
                                .headers(auth(other)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(
                        get("/api/v1/reconstructions/" + finished + "/face-reading")
                                .headers(auth(userId)))
                .andExpect(status().isNotFound());
    }

    @Test
    void 관상_사진은_요청한_본인에게만_저장_금지로_내려_준다() throws Exception {
        String userId = newUser();
        String jobId = newJob(userId, true, "users/x/uploads/p/frames-a1.tar");
        when(frames.frontJpeg("users/x/uploads/p/frames-a1.tar"))
                .thenReturn(new byte[] {(byte) 0xFF, (byte) 0xD8, 1});
        when(engine.read(any())).thenReturn(new FaceReadingEngine.Reading(RESULT, "gpt-test"));
        String photo = "/api/v1/reconstructions/" + jobId + "/face-reading/photo";

        // 관상을 요청하기 전에는 사진도 없다
        mockMvc.perform(get(photo).headers(auth(userId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));

        mockMvc.perform(
                        post("/api/v1/reconstructions/" + jobId + "/face-reading")
                                .headers(auth(userId)))
                .andExpect(status().isAccepted());
        mockMvc.perform(get(photo).headers(auth(userId)))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/jpeg"))
                .andExpect(header().string("Cache-Control", "no-store, private"))
                .andExpect(content().bytes(new byte[] {(byte) 0xFF, (byte) 0xD8, 1}));

        mockMvc.perform(get(photo).headers(auth(newUser())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    private void awaitStatus(String userId, String readingId, String expected) throws Exception {
        String last = null;
        for (int i = 0; i < 50; i++) {
            MvcResult result =
                    mockMvc.perform(get("/api/v1/face-readings/" + readingId).headers(auth(userId)))
                            .andExpect(status().isOk())
                            .andReturn();
            last = JsonPath.read(body(result), "$.data.status");
            if (expected.equals(last)) return;
            Thread.sleep(100);
        }
        assertThat(last).isEqualTo(expected);
    }

    private String newUser() {
        String id = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "insert into user(id, nickname, email, status) values (?, '테스트', 'test@example.com', 'ACTIVE')",
                id);
        return id;
    }

    private String newJob(String userId, boolean framesReady, String framesKey) {
        String uploadId = UUID.randomUUID().toString();
        String jobId = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "insert into face_upload(id, user_id, object_key, content_type, size_bytes, duration_ms,"
                        + " status, url_expires_at, retention_expires_at, checksum_sha256, frames_object_key)"
                        + " values (?, ?, null, 'video/mp4', 1, 30000, 'UPLOADED', utc_timestamp(),"
                        + " utc_timestamp(), 'c2hh', ?)",
                uploadId,
                userId,
                framesKey);
        jdbcTemplate.update(
                "insert into reconstruction_job(id, user_id, face_upload_id, status, frames_ready_at)"
                        + " values (?, ?, ?, 'QUEUED', ?)",
                jobId,
                userId,
                uploadId,
                framesReady ? java.sql.Timestamp.from(java.time.Instant.now()) : null);
        return jobId;
    }

    private HttpHeaders auth(String userId) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(
                jwtProvider.issue(userId, TokenScope.USER, Duration.ofMinutes(30)).value());
        return headers;
    }

    private static String body(MvcResult result) {
        return new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }
}
