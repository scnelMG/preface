package com.preface.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.preface.TestcontainersConfiguration;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import java.time.Duration;
import java.util.List;
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

/** 관리자 복원 작업 API(S15P31B204-652)를 실제 MySQL로 확인한다. 회원·업로드·작업은 합성 행이다. */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AdminJobApiIT {

    private static final String BASE = "/api/v1/admin/reconstructions";

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtProvider jwtProvider;

    @Test
    void 일반_회원은_작업_API도_403_ADM_001이다() throws Exception {
        String user = insertUser("USER");
        for (String path : List.of(BASE, BASE + "/summary?period=7d", BASE + "/queue")) {
            mockMvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, bearer(user)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error.code").value("ADM_001"));
        }
    }

    @Test
    void 회원_조건_목록은_최신순_페이지와_조회_기록을_남기고_조건으로_거른다() throws Exception {
        String admin = insertUser("ADMIN");
        String user = insertUser("USER");
        String older = insertJob(user, "SUCCEEDED", null, 120);
        String newer = insertJob(user, "FAILED", "[\"FIT_FAILED\", \"QUALITY_LIGHT\"]", 60);

        mockMvc.perform(
                        get(BASE)
                                .param("userId", user)
                                .param("size", "500")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.size").value(100))
                .andExpect(jsonPath("$.data.page").value(0))
                .andExpect(jsonPath("$.data.totalElements").value(2))
                .andExpect(jsonPath("$.data.totalPages").value(1))
                .andExpect(jsonPath("$.data.items[0].jobId").value(newer))
                .andExpect(jsonPath("$.data.items[0].failCodes[0]").value("FIT_FAILED"))
                .andExpect(jsonPath("$.data.items[0].captureMethod").value("WEB_RECORDER"))
                .andExpect(jsonPath("$.data.items[0].deviceModel").value("SM-S918N"))
                .andExpect(jsonPath("$.data.items[1].jobId").value(older));

        mockMvc.perform(
                        get(BASE)
                                .param("userId", user)
                                .param("failCode", "QUALITY_LIGHT")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.items[0].jobId").value(newer));
        mockMvc.perform(
                        get(BASE)
                                .param("userId", user)
                                .param("status", "SUCCEEDED")
                                .param("to", "2000-01-01T00:00:00Z")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(jsonPath("$.data.totalElements").value(0));
        mockMvc.perform(
                        get(BASE)
                                .param("status", "EXTRACTING")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));

        List<Map<String, Object>> logs =
                jdbc.queryForList(
                        "select target_type, target_id, request_path from admin_access_log"
                                + " where admin_user_id = ? and target_user_id = ?",
                        admin,
                        user);
        assertThat(logs).hasSize(3);
        assertThat(logs.getFirst())
                .containsEntry("target_type", "JOB")
                .containsEntry("target_id", null)
                .containsEntry("request_path", BASE);
    }

    @Test
    void 상세는_단계_구간과_실패_이전_실패를_주고_조회_기록을_남긴다() throws Exception {
        String admin = insertUser("ADMIN");
        String user = insertUser("USER");
        String previous = insertJob(user, "FAILED", "[\"QUALITY_ANGLE\"]", 300);
        String jobId = insertJob(user, "FAILED", "[\"FIT_FAILED\"]", 60);
        jdbc.update(
                "update reconstruction_job set stage = 'RECONSTRUCT', fail_detail = 'colmap exited 1',"
                        + " quality_report = '{\"yawRangeDeg\": 18}',"
                        + " extract_claimed_at = created_at + interval 2 second,"
                        + " frames_ready_at = created_at + interval 20 second,"
                        + " started_at = created_at + interval 23 second, extract_attempts = 1"
                        + " where id = ?",
                jobId);
        jdbc.update(
                "update face_upload set capture_trace = '{\"trace\": [[0, 1.5, -2.0, true]]}',"
                        + " video_meta = '{\"width\": 1080, \"fps\": 30}'"
                        + " where id = (select face_upload_id from reconstruction_job where id = ?)",
                jobId);
        insertStage(jobId, "EXTRACT", "SUCCEEDED", 2, 20);
        insertStage(jobId, "FRAME_SELECT", "SUCCEEDED", 23, 32);
        insertStage(jobId, "RECONSTRUCT", "FAILED", 32, 60);

        mockMvc.perform(get(BASE + "/" + jobId).header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("FAILED"))
                .andExpect(jsonPath("$.data.extractAttempts").value(1))
                .andExpect(jsonPath("$.data.segments.length()").value(5))
                .andExpect(jsonPath("$.data.segments[0].key").value("EXTRACT_WAIT"))
                .andExpect(jsonPath("$.data.segments[0].durationMs").value(2000))
                .andExpect(jsonPath("$.data.segments[1].key").value("EXTRACT"))
                .andExpect(jsonPath("$.data.segments[1].attempt").value(1))
                .andExpect(jsonPath("$.data.segments[2].key").value("GPU_WAIT"))
                .andExpect(jsonPath("$.data.segments[2].durationMs").value(3000))
                .andExpect(jsonPath("$.data.segments[4].status").value("FAILED"))
                .andExpect(jsonPath("$.data.slowestSegment").value("RECONSTRUCT"))
                .andExpect(jsonPath("$.data.failure.stage").value("RECONSTRUCT"))
                .andExpect(jsonPath("$.data.failure.codes[0]").value("FIT_FAILED"))
                .andExpect(jsonPath("$.data.failure.detail").value("colmap exited 1"))
                .andExpect(jsonPath("$.data.failure.userMessage").doesNotExist())
                .andExpect(jsonPath("$.data.previousFailures.length()").value(1))
                .andExpect(jsonPath("$.data.previousFailures[0].jobId").value(previous))
                .andExpect(jsonPath("$.data.input.videoDurationMs").value(35000))
                .andExpect(jsonPath("$.data.input.frameCount").value(48))
                .andExpect(jsonPath("$.data.input.quality.yawRangeDeg").value(18))
                .andExpect(jsonPath("$.data.input.captureTrace.trace[0][1]").value(1.5))
                .andExpect(jsonPath("$.data.input.videoMeta.width").value(1080))
                .andExpect(jsonPath("$.data.faceModelId").doesNotExist());

        assertThat(
                        jdbc.queryForMap(
                                "select target_user_id, target_type, target_id, request_path"
                                        + " from admin_access_log where admin_user_id = ?",
                                admin))
                .containsEntry("target_user_id", user)
                .containsEntry("target_type", "JOB")
                .containsEntry("target_id", jobId)
                .containsEntry("request_path", BASE + "/" + jobId);

        // 촬영 기록·영상 정보가 없는 업로드는 null
        mockMvc.perform(get(BASE + "/" + previous).header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.input.captureTrace").doesNotExist())
                .andExpect(jsonPath("$.data.input.videoMeta").doesNotExist());

        mockMvc.perform(
                        get(BASE + "/" + UUID.randomUUID())
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    @Test
    void 요약은_실제_상태_이름으로_세고_기간이_틀리면_COMMON_001이다() throws Exception {
        String admin = insertUser("ADMIN");
        String user = insertUser("USER");
        insertJob(user, "SUCCEEDED", null, 30);

        mockMvc.perform(
                        get(BASE + "/summary")
                                .param("period", "7d")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.period").value("7d"))
                .andExpect(jsonPath("$.data.counts.QUEUED").isNumber())
                .andExpect(jsonPath("$.data.counts.CANCELED").isNumber())
                .andExpect(jsonPath("$.data.counts.SUCCEEDED").isNumber())
                .andExpect(jsonPath("$.data.durationMs.targetMs").value(300000))
                .andExpect(jsonPath("$.data.durationMs.p95").isNumber())
                .andExpect(jsonPath("$.data.stuckThresholdMinutes").value(15));
        mockMvc.perform(
                        get(BASE + "/summary")
                                .param("period", "1y")
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void 대기열_순번은_대기열마다_따로_세고_사용자_화면_queuePosition과_같다() throws Exception {
        String admin = insertUser("ADMIN");
        String user = insertUser("USER");
        String expiredUser = insertUser("USER");
        String extractingUser = insertUser("USER");
        String other = insertUser("USER");
        String extractWaiting = insertJob(user, "QUEUED", null, 0);
        // 12분 전 접수, 11분 전에 가져간 추출의 lease(기본 10분)가 끝났다 — 다시 추출 대기, 접수가 빨라 앞선다
        String extractExpired = insertJob(expiredUser, "QUEUED", null, 12);
        jdbc.update(
                "update reconstruction_job set stage = 'FRAME_SELECT', extract_attempts = 1,"
                        + " extract_claimed_at = utc_timestamp() - interval 11 minute where id = ?",
                extractExpired);
        // 지금 추출 중 — 어느 대기열에도 없다
        String extracting = insertJob(extractingUser, "QUEUED", null, 1);
        jdbc.update(
                "update reconstruction_job set stage = 'FRAME_SELECT', extract_attempts = 1,"
                        + " extract_claimed_at = utc_timestamp() where id = ?",
                extracting);
        String gpuWaiting = insertJob(other, "QUEUED", null, 0);
        jdbc.update(
                "update reconstruction_job set stage = 'QUALITY_CHECK',"
                        + " frames_ready_at = utc_timestamp() where id = ?",
                gpuWaiting);

        String body =
                mockMvc.perform(
                                get(BASE + "/queue")
                                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        long waitingPosition = assertPositionMatchesUser(body, "extract", extractWaiting, user);
        long expiredPosition =
                assertPositionMatchesUser(body, "extract", extractExpired, expiredUser);
        assertThat(expiredPosition).isLessThan(waitingPosition);
        assertPositionMatchesUser(body, "gpu", gpuWaiting, other);

        List<Object> extractingPositions =
                JsonPath.read(body, "$.data.extract[?(@.jobId == '" + extracting + "')].position");
        assertThat(extractingPositions).containsExactly((Object) null);
        mockMvc.perform(
                        get("/api/v1/reconstructions/" + extracting)
                                .header(HttpHeaders.AUTHORIZATION, bearer(extractingUser)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.waiting").value(false))
                .andExpect(jsonPath("$.data.waitingSince").doesNotExist())
                .andExpect(jsonPath("$.data.queuePosition").doesNotExist());
        mockMvc.perform(
                        get("/api/v1/reconstructions/" + gpuWaiting)
                                .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                .andExpect(jsonPath("$.data.waiting").value(true))
                .andExpect(jsonPath("$.data.stageIndex").value(2))
                .andExpect(jsonPath("$.data.waitingSince").isString());
        // 다른 테스트에 영향을 주지 않게 끝낸다
        jdbc.update(
                "update reconstruction_job set status = 'CANCELED', finished_at = utc_timestamp()"
                        + " where id in (?, ?, ?, ?)",
                extractWaiting,
                extractExpired,
                extracting,
                gpuWaiting);
    }

    /** 관리자 순번이 그 작업 주인의 queuePosition과 같은지 보고, 그 순번을 돌려준다. */
    private long assertPositionMatchesUser(String body, String list, String jobId, String userId)
            throws Exception {
        List<Integer> positions =
                JsonPath.read(body, "$.data." + list + "[?(@.jobId == '" + jobId + "')].position");
        assertThat(positions).hasSize(1);
        String status =
                mockMvc.perform(
                                get("/api/v1/reconstructions/" + jobId)
                                        .header(HttpHeaders.AUTHORIZATION, bearer(userId)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.waiting").value(true))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        Number userPosition = JsonPath.read(status, "$.data.queuePosition");
        assertThat(positions.getFirst().longValue()).isEqualTo(userPosition.longValue());
        return userPosition.longValue();
    }

    private String insertJob(String userId, String status, String failCodes, int minutesAgo) {
        String uploadId = UUID.randomUUID().toString();
        jdbc.update(
                "insert into face_upload(id, user_id, object_key, content_type, size_bytes, duration_ms,"
                        + " status, url_expires_at, retention_expires_at, checksum_sha256,"
                        + " capture_method, device_model, frame_count)"
                        + " values (?, ?, null, 'video/mp4', 1000, 35000, 'UPLOADED',"
                        + " utc_timestamp() + interval 10 minute, utc_timestamp() + interval 1 day,"
                        + " 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'WEB_RECORDER',"
                        + " 'SM-S918N', 48)",
                uploadId,
                userId);
        String jobId = UUID.randomUUID().toString();
        boolean finished = !"QUEUED".equals(status) && !"RUNNING".equals(status);
        jdbc.update(
                "insert into reconstruction_job(id, user_id, face_upload_id, status, fail_codes,"
                        + " duration_ms, created_at, updated_at, finished_at)"
                        + " values (?, ?, ?, ?, ?, ?, utc_timestamp() - interval ? minute,"
                        + " utc_timestamp() - interval ? minute,"
                        + " if(?, utc_timestamp() - interval ? minute + interval 1 minute, null))",
                jobId,
                userId,
                uploadId,
                status,
                failCodes,
                finished ? 60_000 : null,
                minutesAgo,
                minutesAgo,
                finished,
                minutesAgo);
        return jobId;
    }

    private void insertStage(String jobId, String stage, String status, int startSec, int endSec) {
        jdbc.update(
                "insert into reconstruction_job_stage(id, job_id, attempt, stage, status, started_at,"
                        + " finished_at, duration_ms, worker_id)"
                        + " select uuid(), id, 1, ?, ?, created_at + interval ? second,"
                        + " created_at + interval ? second, ?, 'it-worker' from reconstruction_job"
                        + " where id = ?",
                stage,
                status,
                startSec,
                endSec,
                (endSec - startSec) * 1000,
                jobId);
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
