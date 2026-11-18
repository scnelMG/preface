package com.preface.api.reconstruction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.preface.TestcontainersConfiguration;
import com.preface.api.global.security.AuthProperties;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.service.NoseEditValidatorClient;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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
import org.springframework.test.web.servlet.ResultActions;

/**
 * 업로드 완료 → 프레임 추출(추출 워커) → GPU 대기열 → 워커 claim·진행·결과 → 3D·알림까지 실제 MySQL·Redis로 확인한다.
 *
 * <p>S3만 mock이다(presigned URL은 합성 값). 계약: {@code contracts/reconstruction}.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ReconstructionFlowIT {

    private static final String CHECKSUM = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    private static final String WORKER = "it-worker-1";
    private static final String EXTRACTOR = "it-extractor-1";
    private static final String BUNDLE_CHECKSUM = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;
    @Autowired AuthProperties authProperties;

    @Value("${preface.internal.secret}")
    String internalSecret;

    @MockitoBean ReconstructionStorage storage;
    @MockitoBean NoseEditValidatorClient noseValidator;

    private String userId;
    private String accessToken;

    @BeforeEach
    void setUp() {
        redis.delete(List.of("recon:jobs", "recon:processing"));
        Set<String> claims = redis.keys("recon:claim:*");
        if (claims != null && !claims.isEmpty()) {
            redis.delete(claims);
        }
        when(storage.checkUpload(anyString(), anyLong(), anyString()))
                .thenReturn(ReconstructionStorage.UploadCheck.PRESENT);
        when(storage.presignGet(anyString())).thenReturn(synthetic());
        when(storage.presignPut(anyString(), anyString())).thenReturn(synthetic());
        when(storage.presignPut(anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(synthetic());
        when(noseValidator.validate(
                        anyString(),
                        anyString(),
                        org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.anyMap(),
                        org.mockito.ArgumentMatchers.anyMap(),
                        org.mockito.ArgumentMatchers.anyMap()))
                .thenAnswer(inv -> inv.getArgument(5));
        // 추출 대기열은 DB 행이라, 다른 테스트가 남긴 진행 중 작업을 먼저 치운다
        jdbc.update(
                "update reconstruction_job set status = 'CANCELED', finished_at = utc_timestamp()"
                        + " where status in ('QUEUED', 'RUNNING')");

        userId = newUser(true);
        accessToken = tokenFor(userId);
    }

    @Test
    void 업로드를_알리면_대기열에_들어가고_워커가_성공을_보고하면_3D_원본삭제표시_알림이_생긴다() throws Exception {
        String uploadId = newUpload(userId, "ISSUED");

        String jobId =
                JsonPath.read(
                        body(
                                createJob(uploadId)
                                        .andExpect(status().isAccepted())
                                        .andExpect(jsonPath("$.data.status").value("QUEUED"))
                                        .andExpect(jsonPath("$.data.queuePosition").isNumber())
                                        .andExpect(jsonPath("$.data.waiting").value(true))
                                        .andExpect(jsonPath("$.data.waitingSince").isString())
                                        .andExpect(jsonPath("$.data.pollIntervalMs").value(3000))
                                        .andReturn()),
                        "$.data.jobId");
        assertThat(redis.opsForList().size("recon:jobs")).as("프레임 추출 전에는 GPU 대기열에 넣지 않는다").isZero();
        claim(WORKER).andExpect(status().isNoContent());
        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("QUEUED"))
                .andExpect(jsonPath("$.data.stage").doesNotExist());

        createJob(uploadId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.jobId").value(jobId));
        createJob(newUpload(userId, "ISSUED"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REC_002"));

        String bundleKey = extract(jobId);
        assertThat(redis.opsForList().range("recon:jobs", 0, -1)).containsExactly(jobId);
        // 추출이 끝나면 GPU가 꺼져 있어도 2단계로 보인다
        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("QUEUED"))
                .andExpect(jsonPath("$.data.stage").value("QUALITY_CHECK"))
                .andExpect(jsonPath("$.data.stageIndex").value(2))
                .andExpect(jsonPath("$.data.waiting").value(true))
                .andExpect(jsonPath("$.data.queuePosition").isNumber());
        Map<String, Object> extracted =
                jdbc.queryForMap(
                        "select object_key, frames_object_key, frame_count,"
                                + " cast(lens_meta as char) lens from face_upload where id = ?",
                        uploadId);
        assertThat(extracted.get("object_key")).as("추출 뒤 원본 영상 주소를 지운다").isNull();
        assertThat(extracted.get("frames_object_key")).isEqualTo(bundleKey);
        assertThat(extracted.get("frame_count")).isEqualTo(87);
        assertThat((String) extracted.get("lens")).contains("focalSource");
        assertThat(
                        jdbc.queryForObject(
                                "select object_key from data_deletion_log where target_type = 'FACE_UPLOAD'"
                                        + " and target_id = ? and status = 'PENDING'",
                                String.class,
                                uploadId))
                .as("원본 영상 S3 삭제가 추출 직후 예약된다")
                .isEqualTo("users/" + userId + "/uploads/" + uploadId + ".mov");

        String prefix = "users/" + userId + "/models/" + jobId + "/a1/";
        claim(WORKER)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.jobId").value(jobId))
                .andExpect(jsonPath("$.data.input.downloadUrl").isNotEmpty())
                .andExpect(jsonPath("$.data.input.contentType").value("application/x-tar"))
                .andExpect(jsonPath("$.data.input.checksumSha256").value(BUNDLE_CHECKSUM))
                .andExpect(jsonPath("$.data.input.sizeBytes").value(5000))
                .andExpect(jsonPath("$.data.input.frameCount").value(87))
                .andExpect(jsonPath("$.data.input.lens.focalPx").value(1412.5))
                .andExpect(jsonPath("$.data.input.lens.focalSource").value("file"))
                .andExpect(jsonPath("$.data.outputPrefix").value(prefix))
                .andExpect(jsonPath("$.data.morphSchemaVersion").value("v1"))
                .andExpect(jsonPath("$.data.leaseTimeoutSec").value(600));
        assertThat(redis.opsForList().range("recon:processing", 0, -1)).containsExactly(jobId);
        assertThat(redis.opsForList().size("recon:jobs")).isZero();
        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("RUNNING"))
                .andExpect(jsonPath("$.data.stage").value("QUALITY_CHECK"))
                .andExpect(jsonPath("$.data.startedAt").isNotEmpty());

        progress(jobId, WORKER, "FRAME_SELECT").andExpect(status().isOk());
        progress(jobId, WORKER, "RECONSTRUCT")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.continue").value(true));
        // heartbeat: 같은 단계의 반복 보고는 단계 기록 행을 늘리지 않는다
        progress(jobId, WORKER, "RECONSTRUCT").andExpect(status().isOk());
        progress(jobId, "someone-else", "FINALIZE")
                .andExpect(jsonPath("$.data.continue").value(false));
        getJob(jobId)
                .andExpect(jsonPath("$.data.stage").value("RECONSTRUCT"))
                .andExpect(jsonPath("$.data.stageIndex").value(3));
        mockMvc.perform(get("/api/v1/reconstructions/current").header(auth(), bearer()))
                .andExpect(jsonPath("$.data.jobId").value(jobId));

        internal(post("/internal/v1/reconstructions/" + jobId + "/output-urls"), WORKER, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.mesh.objectKey").value(prefix + "mesh.glb"))
                .andExpect(jsonPath("$.data.rig.objectKey").value(prefix + "rig.json"))
                .andExpect(
                        jsonPath("$.data.expression.objectKey").value(prefix + "expression.json"))
                .andExpect(jsonPath("$.data.mesh.method").value("PUT"))
                .andExpect(
                        jsonPath("$.data.captures.LEFT_45.objectKey")
                                .value(prefix + "captures/left_45.jpg"))
                .andExpect(jsonPath("$.data.captures.length()").value(5));

        String success = successBody(prefix, true);
        String faceModelId =
                JsonPath.read(
                        body(result(jobId, WORKER, success).andExpect(status().isOk()).andReturn()),
                        "$.data.faceModelId");
        assertThat(faceModelId).isNotBlank();
        verifyBaselineMeasurementRoundTrip(faceModelId);
        verifyExpressionRig(faceModelId, prefix);
        assertThat(
                        jdbc.queryForObject(
                                "select chat_apply_ready from face_model where id = ?",
                                Boolean.class,
                                faceModelId))
                .isTrue();
        assertThat(
                        jdbc.queryForList(
                                "select angle from face_capture_image where face_model_id = ?"
                                        + " and user_id = ? and object_key like ? order by angle",
                                String.class,
                                faceModelId,
                                userId,
                                prefix + "captures/%"))
                .as("설문용 5방향 사진이 3D와 함께 저장된다")
                .containsExactly("FRONT", "LEFT", "LEFT_45", "RIGHT", "RIGHT_45");
        assertThat(
                        jdbc.queryForObject(
                                "select object_key from data_deletion_log"
                                        + " where target_type = 'FACE_UPLOAD_FRAMES' and target_id = ?",
                                String.class,
                                uploadId))
                .as("3D 성공 즉시 프레임 묶음 삭제를 예약한다")
                .isEqualTo(bundleKey);
        result(jobId, WORKER, success).andExpect(jsonPath("$.data.faceModelId").value(faceModelId));
        assertThat(redis.opsForList().size("recon:processing")).isZero();
        assertThat(
                        jdbc.queryForList(
                                "select concat(stage, ':', attempt, ':', status, ':',"
                                        + " coalesce(worker_id, '-'), ':', finished_at is not null)"
                                        + " from reconstruction_job_stage where job_id = ?"
                                        + " order by started_at, id",
                                String.class,
                                jobId))
                .as("관리자 화면용 단계 기록(S15P31B204-652)")
                .hasSize(3)
                .startsWith("EXTRACT:1:SUCCEEDED:" + EXTRACTOR + ":1")
                .contains(
                        "FRAME_SELECT:1:SUCCEEDED:" + WORKER + ":1",
                        "RECONSTRUCT:1:SUCCEEDED:" + WORKER + ":1");

        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("SUCCEEDED"))
                .andExpect(jsonPath("$.data.stage").value("FINALIZE"))
                .andExpect(jsonPath("$.data.faceModelId").value(faceModelId))
                .andExpect(jsonPath("$.data.failCodes.length()").value(0));
        mockMvc.perform(get("/api/v1/reconstructions/current").header(auth(), bearer()))
                .andExpect(jsonPath("$.data").doesNotExist());

        Map<String, Object> model =
                jdbc.queryForMap(
                        "select mesh_object_key, rig_object_key, morph_schema_version, title from face_model where id = ?",
                        faceModelId);
        assertThat(model.get("mesh_object_key")).isEqualTo(prefix + "mesh.glb");
        assertThat(model.get("rig_object_key")).isEqualTo(prefix + "rig.json");
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from data_deletion_log where target_type = 'RECON_OUTPUT'"
                                        + " and target_id = ?",
                                Integer.class,
                                jobId))
                .isEqualTo(11);
        assertThat(
                        jdbc.queryForList(
                                "select object_key from data_deletion_log"
                                        + " where target_type = 'RECON_OUTPUT' and target_id = ?",
                                String.class,
                                jobId))
                .contains(prefix.replace("/a1/", "/a2/") + "mesh.glb")
                .doesNotContain(
                        prefix + "mesh.glb", prefix + "rig.json", prefix + "expression.json");
        assertThat(model.get("title")).isEqualTo("내 머리");
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from data_deletion_log where target_type = 'FACE_UPLOAD'"
                                        + " and target_id = ? and status = 'PENDING'"
                                        + " and reason = 'RETENTION_POLICY'",
                                Integer.class,
                                uploadId))
                .isEqualTo(1);
        Map<String, Object> upload =
                jdbc.queryForMap(
                        "select status, cast(video_meta as char) meta, frames_object_key,"
                                + " retention_expires_at <= utc_timestamp() due from face_upload where id = ?",
                        uploadId);
        assertThat(upload.get("status")).isEqualTo("UPLOADED");
        assertThat(upload.get("frames_object_key")).isNull();
        assertThat((String) upload.get("meta")).contains("deviceModel").doesNotContain("gps");
        assertThat(((Number) upload.get("due")).intValue()).isEqualTo(1);

        mockMvc.perform(get("/api/v1/notifications").header(auth(), bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.unreadCount").value(1))
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.items[0].type").value("RECON_SUCCEEDED"))
                .andExpect(jsonPath("$.data.items[0].target.kind").value("FACE_MODEL"))
                .andExpect(jsonPath("$.data.items[0].target.id").value(faceModelId))
                .andExpect(jsonPath("$.data.items[0].readAt").doesNotExist());
        mockMvc.perform(
                        post("/api/v1/notifications/read")
                                .header(auth(), bearer())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"all\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.unreadCount").value(0));
    }

    @Test
    void 실패를_보고하면_실패_코드가_남고_최근_실패로_조회되며_알림은_ID로_읽음_처리된다() throws Exception {
        String jobId = createAndClaim();

        result(
                        jobId,
                        WORKER,
                        "{\"status\":\"FAILED\",\"failCodes\":[\"QUALITY_ANGLE\",\"QUALITY_LIGHT\"],"
                                + "\"debugMessage\":\"yaw range 18deg\",\"qualityReport\":{\"yawRangeDeg\":18}}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.faceModelId").doesNotExist());
        assertThat(
                        jdbc.queryForList(
                                "select object_key from data_deletion_log"
                                        + " where target_type = 'RECON_OUTPUT' and target_id = ?"
                                        + " and object_key like '%/rig.json'"
                                        + " order by object_key",
                                String.class, jobId))
                .containsExactly(
                        "users/" + userId + "/models/" + jobId + "/a1/rig.json",
                        "users/" + userId + "/models/" + jobId + "/a2/rig.json");
        result(jobId, WORKER, successBody("users/" + userId + "/models/" + jobId + "/a1/"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REC_021"));

        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("FAILED"))
                .andExpect(jsonPath("$.data.failCodes[0]").value("QUALITY_ANGLE"))
                .andExpect(jsonPath("$.data.failCodes[1]").value("QUALITY_LIGHT"))
                .andExpect(jsonPath("$.data.finishedAt").isNotEmpty());
        mockMvc.perform(get("/api/v1/reconstructions/current").header(auth(), bearer()))
                .andExpect(jsonPath("$.data").doesNotExist());
        mockMvc.perform(
                        get("/api/v1/reconstructions/current")
                                .param("includeRecentFailed", "true")
                                .header(auth(), bearer()))
                .andExpect(jsonPath("$.data.jobId").value(jobId))
                .andExpect(jsonPath("$.data.status").value("FAILED"));

        MvcResult list =
                mockMvc.perform(get("/api/v1/notifications").header(auth(), bearer()))
                        .andExpect(jsonPath("$.data.items[0].type").value("RECON_FAILED"))
                        .andExpect(jsonPath("$.data.items[0].target.kind").value("RECON_JOB"))
                        .andExpect(jsonPath("$.data.items[0].target.id").value(jobId))
                        .andReturn();
        String notificationId = JsonPath.read(body(list), "$.data.items[0].notificationId");
        mockMvc.perform(
                        post("/api/v1/notifications/read")
                                .header(auth(), bearer())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"notificationIds\":[\""
                                                + notificationId
                                                + "\",\""
                                                + UUID.randomUUID()
                                                + "\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.unreadCount").value(0));
        mockMvc.perform(
                        post("/api/v1/notifications/read")
                                .header(auth(), bearer())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
    }

    @Test
    void 코_승인이_실패하면_완료_모델과_성공_상태를_남기지_않는다() throws Exception {
        String jobId = createAndClaim();
        when(noseValidator.validate(
                        anyString(),
                        anyString(),
                        org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.anyMap(),
                        org.mockito.ArgumentMatchers.anyMap(),
                        org.mockito.ArgumentMatchers.anyMap()))
                .thenReturn(Map.of());

        result(jobId, WORKER, successBody("users/" + userId + "/models/" + jobId + "/a1/"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_031"));
        getJob(jobId).andExpect(jsonPath("$.data.status").value("RUNNING"));
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from face_model where reconstruction_job_id = ?",
                                Integer.class,
                                jobId))
                .isZero();
    }

    @Test
    void 회수돼_대기열로_돌아간_작업에_이전_워커가_보고하면_REC_022이고_다른_워커가_다시_가져간다() throws Exception {
        String jobId = createAndClaim();
        requeueAsLeaseRecovery(jobId);

        getJob(jobId).andExpect(jsonPath("$.data.status").value("QUEUED"));
        result(jobId, WORKER, successBody("users/" + userId + "/models/" + jobId + "/a1/"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REC_022"));
        progress(jobId, WORKER, "RECONSTRUCT").andExpect(jsonPath("$.data.continue").value(false));

        claim("it-worker-2").andExpect(jsonPath("$.data.jobId").value(jobId));
        assertThat(redis.opsForHash().get("recon:claim:" + jobId, "attempts")).isEqualTo("2");
        assertThat(redis.opsForHash().get("recon:claim:" + jobId, "workerId"))
                .isEqualTo("it-worker-2");
        String prefix = "users/" + userId + "/models/" + jobId + "/a2/";
        internal(
                        post("/internal/v1/reconstructions/" + jobId + "/output-urls"),
                        "it-worker-2",
                        null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.mesh.objectKey").value(prefix + "mesh.glb"))
                .andExpect(jsonPath("$.data.rig.objectKey").value(prefix + "rig.json"));
        result(
                        jobId,
                        "it-worker-2",
                        successBody("users/" + userId + "/models/" + jobId + "/a1/", true))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
        String modelId =
                JsonPath.read(
                        body(
                                result(jobId, "it-worker-2", successBody(prefix, true))
                                        .andExpect(status().isOk())
                                        .andReturn()),
                        "$.data.faceModelId");
        assertThat(
                        jdbc.queryForMap(
                                "select mesh_object_key, rig_object_key from face_model where id = ?",
                                modelId))
                .containsEntry("mesh_object_key", prefix + "mesh.glb")
                .containsEntry("rig_object_key", prefix + "rig.json");
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from data_deletion_log"
                                        + " where target_type = 'RECON_OUTPUT' and target_id = ?"
                                        + " and object_key like ?",
                                Integer.class,
                                jobId,
                                "users/" + userId + "/models/" + jobId + "/a1/%"))
                .isEqualTo(10);
    }

    @Test
    void INTERNAL_실패는_한_번_다시_대기열에_들어가고_두_번째도_INTERNAL이면_실패로_끝난다() throws Exception {
        String jobId = createAndClaim();
        String internal =
                "{\"status\":\"FAILED\",\"failCodes\":[\"INTERNAL\"],"
                        + "\"debugMessage\":\"3d build killed by signal 11\"}";

        result(jobId, WORKER, internal)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.faceModelId").doesNotExist());
        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("QUEUED"))
                .andExpect(jsonPath("$.data.failCodes").isEmpty());
        assertThat(redis.opsForList().range("recon:jobs", 0, -1)).containsExactly(jobId);
        assertThat(redis.opsForList().range("recon:processing", 0, -1)).doesNotContain(jobId);
        assertThat(
                        jdbc.queryForObject(
                                "select count(*) from notification where target_id = ?",
                                Integer.class,
                                jobId))
                .as("재시도 중에는 실패 알림을 보내지 않는다")
                .isZero();
        // 같은 보고의 재전송은 재배정으로 거절된다(워커는 버린다)
        result(jobId, WORKER, internal)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REC_022"));

        claim("it-worker-2").andExpect(jsonPath("$.data.jobId").value(jobId));
        assertThat(redis.opsForHash().get("recon:claim:" + jobId, "attempts")).isEqualTo("2");
        result(jobId, "it-worker-2", internal).andExpect(status().isOk());

        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("FAILED"))
                .andExpect(jsonPath("$.data.failCodes[0]").value("INTERNAL"));
        assertThat(redis.opsForList().size("recon:jobs")).isZero();
        mockMvc.perform(get("/api/v1/notifications").header(auth(), bearer()))
                .andExpect(jsonPath("$.data.items[0].type").value("RECON_FAILED"));
    }

    @Test
    void 사진_문제나_INTERNAL과_다른_코드가_섞인_실패는_재시도하지_않는다() throws Exception {
        String fit = createAndClaim();
        result(fit, WORKER, "{\"status\":\"FAILED\",\"failCodes\":[\"FIT_FAILED\"]}")
                .andExpect(status().isOk());
        getJob(fit).andExpect(jsonPath("$.data.status").value("FAILED"));

        String mixed = createAndClaim();
        result(mixed, WORKER, "{\"status\":\"FAILED\",\"failCodes\":[\"INTERNAL\",\"TIMEOUT\"]}")
                .andExpect(status().isOk());
        getJob(mixed).andExpect(jsonPath("$.data.status").value("FAILED"));
        assertThat(redis.opsForList().size("recon:jobs")).isZero();
    }

    @Test
    void 내부_API는_시크릿이_틀리거나_없으면_AUTH_001이고_사용자_토큰으로_열리지_않는다() throws Exception {
        String claimBody = "{\"workerId\":\"" + WORKER + "\"}";
        mockMvc.perform(
                        post("/internal/v1/reconstruction-jobs/claim")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(claimBody))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_001"));
        mockMvc.perform(
                        post("/internal/v1/reconstruction-jobs/claim")
                                .header("X-Internal-Secret", internalSecret + "x")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(claimBody))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(
                        post("/internal/v1/reconstruction-jobs/claim")
                                .header(auth(), bearer())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(claimBody))
                .andExpect(status().isUnauthorized());

        claim(WORKER).andExpect(status().isNoContent());
        progress(UUID.randomUUID().toString(), WORKER, "RECONSTRUCT")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        internal(
                        post("/internal/v1/reconstructions/" + UUID.randomUUID() + "/progress"),
                        null,
                        "{\"status\":\"RUNNING\",\"stage\":\"RECONSTRUCT\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
    }

    @Test
    void 남의_작업은_404이고_동의가_없거나_업로드가_만료되면_만들지_않는다() throws Exception {
        String jobId = createAndClaim();
        String other = tokenFor(newUser(true));
        mockMvc.perform(get("/api/v1/reconstructions/" + jobId).header(auth(), "Bearer " + other))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(
                        post("/api/v1/reconstructions")
                                .header(auth(), "Bearer " + other)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"uploadId\":\"" + newUpload(userId, "ISSUED") + "\"}"))
                .andExpect(status().isNotFound());

        String noConsent = newUser(false);
        mockMvc.perform(
                        post("/api/v1/reconstructions")
                                .header(auth(), "Bearer " + tokenFor(noConsent))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"uploadId\":\""
                                                + newUpload(noConsent, "ISSUED")
                                                + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("CAP_001"));

        String fresh = newUser(true);
        mockMvc.perform(
                        post("/api/v1/reconstructions")
                                .header(auth(), "Bearer " + tokenFor(fresh))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"uploadId\":\"" + newUpload(fresh, "EXPIRED") + "\"}"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.error.code").value("CAP_004"));
        when(storage.checkUpload(anyString(), anyLong(), anyString()))
                .thenReturn(ReconstructionStorage.UploadCheck.CHECKSUM_MISMATCH);
        mockMvc.perform(
                        post("/api/v1/reconstructions")
                                .header(auth(), "Bearer " + tokenFor(fresh))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"uploadId\":\"" + newUpload(fresh, "ISSUED") + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CAP_005"));
    }

    @Test
    void 추출_실패를_보고하면_작업이_실패로_끝나고_GPU_대기열에_들어가지_않으며_올렸을_묶음을_지운다() throws Exception {
        String uploadId = newUpload(userId, "ISSUED");
        String jobId = JsonPath.read(body(createJob(uploadId).andReturn()), "$.data.jobId");
        extractionClaim(EXTRACTOR)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.jobId").value(jobId))
                .andExpect(jsonPath("$.data.attempt").value(1))
                .andExpect(jsonPath("$.data.input.checksumSha256").value(CHECKSUM))
                .andExpect(jsonPath("$.data.maxFrames").value(100));

        String failed =
                "{\"attempt\":1,\"status\":\"FAILED\",\"failCodes\":[\"QUALITY_NO_FACE\"],"
                        + "\"debugMessage\":\"no face in most samples\"}";
        extractionResult(jobId, EXTRACTOR, failed)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accepted").value(true));
        // 응답을 못 받은 워커의 재전송은 같은 결과로 받아들인다
        extractionResult(jobId, EXTRACTOR, failed)
                .andExpect(jsonPath("$.data.accepted").value(true));

        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("FAILED"))
                .andExpect(jsonPath("$.data.failCodes[0]").value("QUALITY_NO_FACE"));
        assertThat(redis.opsForList().size("recon:jobs")).isZero();
        assertThat(
                        jdbc.queryForList(
                                "select object_key from data_deletion_log"
                                        + " where target_type = 'FACE_UPLOAD_FRAMES' and target_id = ?",
                                String.class,
                                uploadId))
                .containsExactly(bundleKey(uploadId, 1));
        Map<String, Object> upload =
                jdbc.queryForMap(
                        "select object_key, retention_expires_at > utc_timestamp() kept"
                                + " from face_upload where id = ?",
                        uploadId);
        assertThat(upload.get("object_key")).as("실패하면 원본은 24시간 보관").isNotNull();
        assertThat(((Number) upload.get("kept")).intValue()).isEqualTo(1);
        mockMvc.perform(get("/api/v1/notifications").header(auth(), bearer()))
                .andExpect(jsonPath("$.data.items[0].type").value("RECON_FAILED"));
    }

    @Test
    void 추출_lease가_끝나면_다른_워커가_다시_가져가고_이전_시도의_보고는_거절되며_시도를_넘기면_TIMEOUT이다() throws Exception {
        String uploadId = newUpload(userId, "ISSUED");
        String jobId = JsonPath.read(body(createJob(uploadId).andReturn()), "$.data.jobId");
        extractionClaim(EXTRACTOR).andExpect(jsonPath("$.data.attempt").value(1));
        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("QUEUED"))
                .andExpect(jsonPath("$.data.stage").value("FRAME_SELECT"))
                .andExpect(jsonPath("$.data.stageIndex").value(1));
        extractionClaim("it-extractor-2").andExpect(status().isNoContent());

        expireExtractionLease(jobId);
        extractionClaim("it-extractor-2")
                .andExpect(jsonPath("$.data.jobId").value(jobId))
                .andExpect(jsonPath("$.data.attempt").value(2));
        internal(
                        post("/internal/v1/frame-extraction-jobs/" + jobId + "/bundle-url"),
                        EXTRACTOR,
                        bundleUrlBody(1))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REC_022"));
        extractionResult(jobId, EXTRACTOR, successResult(uploadId, 1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accepted").value(false));
        assertThat(
                        jdbc.queryForList(
                                "select object_key from data_deletion_log"
                                        + " where target_type = 'FACE_UPLOAD_FRAMES' and target_id = ?",
                                String.class,
                                uploadId))
                .as("받아들이지 않은 이전 시도의 묶음은 지운다")
                .containsExactly(bundleKey(uploadId, 1));
        getJob(jobId).andExpect(jsonPath("$.data.status").value("QUEUED"));

        expireExtractionLease(jobId);
        extractionClaim(EXTRACTOR).andExpect(status().isNoContent());
        getJob(jobId)
                .andExpect(jsonPath("$.data.status").value("FAILED"))
                .andExpect(jsonPath("$.data.failCodes[0]").value("TIMEOUT"));
    }

    @Test
    void 앞선_시도가_보고_없이_끊기고_다음_시도가_성공하면_쓰지_않는_시도의_묶음을_지운다() throws Exception {
        String uploadId = newUpload(userId, "ISSUED");
        String jobId = JsonPath.read(body(createJob(uploadId).andReturn()), "$.data.jobId");
        extractionClaim(EXTRACTOR).andExpect(jsonPath("$.data.attempt").value(1));
        // 시도 1은 묶음을 올렸을 수 있지만 결과 보고 전에 끊겼다
        expireExtractionLease(jobId);

        assertThat(extract(jobId)).isEqualTo(bundleKey(uploadId, 2));

        assertThat(
                        jdbc.queryForList(
                                "select object_key from data_deletion_log"
                                        + " where target_type = 'FACE_UPLOAD_FRAMES' and target_id = ?",
                                String.class,
                                uploadId))
                .as("쓰지 않는 시도 1의 묶음만 지우고, 저장한 시도 2의 묶음은 남긴다")
                .containsExactly(bundleKey(uploadId, 1));
        getJob(jobId).andExpect(jsonPath("$.data.status").value("QUEUED"));
    }

    // --- helpers ---

    @Test
    void 휴대폰_세션으로_만든_작업은_QR_링크가_UPLOADED가_되고_그_세션은_그_작업만_본다() throws Exception {
        String created =
                body(
                        mockMvc.perform(post("/api/v1/capture-links").header(auth(), bearer()))
                                .andExpect(status().isCreated())
                                .andReturn());
        String linkId = JsonPath.read(created, "$.data.linkId");
        String qrUrl = JsonPath.read(created, "$.data.qrUrl");
        String qrToken = qrUrl.substring(qrUrl.indexOf("#t=") + 3);
        String capture =
                "Bearer "
                        + JsonPath.read(
                                body(
                                        mockMvc.perform(
                                                        post("/api/v1/capture-links/exchange")
                                                                .contentType(
                                                                        MediaType.APPLICATION_JSON)
                                                                .content(
                                                                        "{\"token\":\""
                                                                                + qrToken
                                                                                + "\"}"))
                                                .andExpect(status().isOk())
                                                .andReturn()),
                                "$.data.captureSessionToken");

        String jobId =
                JsonPath.read(
                        body(
                                mockMvc.perform(
                                                post("/api/v1/reconstructions")
                                                        .header(auth(), capture)
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content(
                                                                "{\"uploadId\":\""
                                                                        + newUpload(
                                                                                userId, "ISSUED")
                                                                        + "\"}"))
                                        .andExpect(status().isAccepted())
                                        .andReturn()),
                        "$.data.jobId");

        mockMvc.perform(get("/api/v1/capture-links/" + linkId).header(auth(), bearer()))
                .andExpect(jsonPath("$.data.status").value("UPLOADED"))
                .andExpect(jsonPath("$.data.jobId").value(jobId));
        mockMvc.perform(get("/api/v1/reconstructions/" + jobId).header(auth(), capture))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("QUEUED"));
        mockMvc.perform(get("/api/v1/reconstructions/" + UUID.randomUUID()).header(auth(), capture))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/reconstructions/current").header(auth(), capture))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("AUTH_023"));
    }

    private String createAndClaim() throws Exception {
        String jobId =
                JsonPath.read(
                        body(createJob(newUpload(userId, "ISSUED")).andReturn()), "$.data.jobId");
        extract(jobId);
        claim(WORKER).andExpect(jsonPath("$.data.jobId").value(jobId));
        return jobId;
    }

    /** 추출 워커 한 바퀴(claim → 묶음 URL → 성공 보고). 묶음 key를 돌려준다. */
    private String extract(String jobId) throws Exception {
        String claimed =
                body(
                        extractionClaim(EXTRACTOR)
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.data.jobId").value(jobId))
                                .andReturn());
        int attempt = JsonPath.read(claimed, "$.data.attempt");
        String uploadId =
                jdbc.queryForObject(
                        "select face_upload_id from reconstruction_job where id = ?",
                        String.class,
                        jobId);
        internal(
                        post("/internal/v1/frame-extraction-jobs/" + jobId + "/bundle-url"),
                        EXTRACTOR,
                        bundleUrlBody(attempt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.objectKey").value(bundleKey(uploadId, attempt)))
                .andExpect(jsonPath("$.data.method").value("PUT"));
        extractionResult(jobId, EXTRACTOR, successResult(uploadId, attempt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.accepted").value(true));
        return bundleKey(uploadId, attempt);
    }

    private String bundleKey(String uploadId, int attempt) {
        return "users/" + userId + "/uploads/" + uploadId + "/frames-a" + attempt + ".tar";
    }

    private static String bundleUrlBody(int attempt) {
        return "{\"attempt\":"
                + attempt
                + ",\"sizeBytes\":5000,\"checksumSha256\":\""
                + BUNDLE_CHECKSUM
                + "\"}";
    }

    private String successResult(String uploadId, int attempt) {
        return "{\"attempt\":"
                + attempt
                + ",\"status\":\"SUCCEEDED\",\"bundle\":{\"objectKey\":\""
                + bundleKey(uploadId, attempt)
                + "\",\"sizeBytes\":5000,\"checksumSha256\":\""
                + BUNDLE_CHECKSUM
                + "\",\"frameCount\":87},"
                + "\"lens\":{\"focalPx\":1412.5,\"focalSource\":\"file\",\"focal35mm\":26},"
                + "\"videoMeta\":{\"width\":1080,\"height\":1920,\"deviceModel\":\"Test-1\"}}";
    }

    @Test
    void 웹_녹화_기종은_추출_작업에_capture로_나가고_없으면_필드가_없다() throws Exception {
        String uploadId = newUpload(userId, "ISSUED");
        jdbc.update(
                "update face_upload set capture_method = 'WEB_RECORDER', device_model = 'SM-S921N' where id = ?",
                uploadId);
        createJob(uploadId).andExpect(status().isAccepted());

        extractionClaim(EXTRACTOR)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.capture.method").value("WEB_RECORDER"))
                .andExpect(jsonPath("$.data.capture.deviceModel").value("SM-S921N"));
    }

    @Test
    void 웹_녹화_촬영_기록은_추출_작업의_capture_trace로_그대로_나간다() throws Exception {
        String uploadId = newUpload(userId, "ISSUED");
        // 합성 값: 0ms·50ms 두 표본과 단계 하나
        jdbc.update(
                "update face_upload set capture_method = 'WEB_RECORDER', capture_trace = ? where id = ?",
                "{\"version\":1,\"steps\":[{\"name\":\"recleft\",\"startMs\":0,\"endMs\":50}],"
                        + "\"trace\":[[0,55.0,-1.0,1],[50,null,null,0]],\"trackSettings\":{\"width\":1920}}",
                uploadId);
        createJob(uploadId).andExpect(status().isAccepted());

        extractionClaim(EXTRACTOR)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.capture.method").value("WEB_RECORDER"))
                .andExpect(jsonPath("$.data.capture.trace.version").value(1))
                .andExpect(jsonPath("$.data.capture.trace.trace[0][1]").value(55.0))
                .andExpect(jsonPath("$.data.capture.trace.trace[1][3]").value(0))
                .andExpect(jsonPath("$.data.capture.trace.steps[0].name").value("recleft"))
                .andExpect(jsonPath("$.data.capture.trace.trackSettings.width").value(1920));
    }

    @Test
    void 촬영_정보가_없는_예전_업로드는_추출_작업에_capture가_없다() throws Exception {
        createJob(newUpload(userId, "ISSUED")).andExpect(status().isAccepted());

        extractionClaim(EXTRACTOR)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.capture").doesNotExist());
    }

    /** 추출 lease가 끝난 상태를 만든다(가져간 시각을 lease보다 앞으로). */
    private void expireExtractionLease(String jobId) {
        jdbc.update(
                "update reconstruction_job set extract_claimed_at = utc_timestamp() - interval 1 hour"
                        + " where id = ?",
                jobId);
    }

    private ResultActions extractionClaim(String workerId) throws Exception {
        return internal(
                post("/internal/v1/frame-extraction-jobs/claim"),
                null,
                "{\"workerId\":\"" + workerId + "\"}");
    }

    private ResultActions extractionResult(String jobId, String workerId, String json)
            throws Exception {
        return internal(
                post("/internal/v1/frame-extraction-jobs/" + jobId + "/result"), workerId, json);
    }

    /**
     * job-manager lease 회수(첫 회수)가 남기는 상태를 그대로 만든다: DB QUEUED, 대기열 뒤로, claim 메타는 시도 횟수만 남김. 회수 자체는
     * job-manager {@code LeaseRecoveryIT}가 확인한다.
     */
    private void requeueAsLeaseRecovery(String jobId) {
        jdbc.update(
                "update reconstruction_job set status = 'QUEUED',"
                        + " stage = if(frames_ready_at is null, null, 'QUALITY_CHECK'), engine = null"
                        + " where id = ?",
                jobId);
        redis.opsForList().leftPush("recon:jobs", jobId);
        redis.opsForList().remove("recon:processing", 0, jobId);
        redis.opsForHash().delete("recon:claim:" + jobId, "workerId", "lastSeenAt");
    }

    private ResultActions createJob(String uploadId) throws Exception {
        return mockMvc.perform(
                post("/api/v1/reconstructions")
                        .header(auth(), bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"uploadId\":\"" + uploadId + "\"}"));
    }

    private ResultActions getJob(String jobId) throws Exception {
        return mockMvc.perform(get("/api/v1/reconstructions/" + jobId).header(auth(), bearer()))
                .andExpect(status().isOk());
    }

    private ResultActions claim(String workerId) throws Exception {
        return internal(
                post("/internal/v1/reconstruction-jobs/claim"),
                null,
                "{\"workerId\":\"" + workerId + "\"}");
    }

    private ResultActions progress(String jobId, String workerId, String stage) throws Exception {
        return internal(
                post("/internal/v1/reconstructions/" + jobId + "/progress"),
                workerId,
                "{\"status\":\"RUNNING\",\"stage\":\"" + stage + "\",\"engine\":\"VGGT\"}");
    }

    private ResultActions result(String jobId, String workerId, String json) throws Exception {
        return internal(post("/internal/v1/reconstructions/" + jobId + "/result"), workerId, json);
    }

    private ResultActions internal(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
            String workerId,
            String json)
            throws Exception {
        request.header("X-Internal-Secret", internalSecret);
        if (workerId != null) {
            request.header("X-Worker-Id", workerId);
        }
        if (json != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(json);
        }
        return mockMvc.perform(request);
    }

    /**
     * 표정 트래킹 리그(S15P31B204-879): 결과 보고로 저장되고 상세에서 서명 URL로 나간다. 기존 모델 보충 요청은 같은 key면 그대로 성공하고 다른 폴더
     * key는 거절한다.
     */
    private void verifyExpressionRig(String modelId, String prefix) throws Exception {
        String key = prefix + "expression.json";
        assertThat(
                        jdbc.queryForObject(
                                "select expression_object_key from face_model where id = ?",
                                String.class,
                                modelId))
                .isEqualTo(key);
        mockMvc.perform(get("/api/v1/face-models/" + modelId).header(auth(), bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.expressionUrl").isNotEmpty());
        String path = "/internal/v1/face-models/" + modelId + "/expression-rig";
        internal(post(path), null, "{\"objectKey\":\"" + key + "\"}").andExpect(status().isOk());
        internal(post(path), null, "{\"objectKey\":\"" + key.replace("/a1/", "/a2/") + "\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
        assertThat(
                        jdbc.queryForObject(
                                "select expression_object_key from face_model where id = ?",
                                String.class,
                                modelId))
                .isEqualTo(key);
    }

    private void verifyBaselineMeasurementRoundTrip(String modelId) throws Exception {
        String publicPath = "/api/v1/face-models/" + modelId + "/baseline-measurements";
        String internalPath = "/internal/v1/face-models/" + modelId + "/baseline-measurements";
        String report =
                """
                {
                  "schemaVersion": "v1",
                  "binding": {
                    "meshSha256": "%1$s", "rigSha256": "%2$s", "fitSha": "synthetic",
                    "engine": "synthetic", "rigVersion": "v1", "topologyVersion": "synthetic"
                  },
                  "review": {
                    "meshSha256": "%1$s", "definition": "alar-lateral-frontal-basal-v1",
                    "unit": "model-space", "anatomicalQuality": "reviewed-pair",
                    "observedBounds": {"alarWidth": [0.034, 0.036], "intercanthalDistance": [0.030, 0.031]}
                  }
                }
                """
                        .formatted("a".repeat(64), "b".repeat(64));
        mockMvc.perform(get(publicPath).header(auth(), bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DEFERRED"));
        mockMvc.perform(
                        put(internalPath)
                                .header(auth(), bearer())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(report))
                .andExpect(status().isUnauthorized());
        internal(put(internalPath), WORKER, report)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("AVAILABLE"));
        mockMvc.perform(get(publicPath).header(auth(), bearer()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.observations[0].lower").value(0.034))
                .andExpect(jsonPath("$.data.observations[1].upper").value(0.031))
                .andExpect(jsonPath("$.data.binding").doesNotExist());
        mockMvc.perform(get(publicPath).header(auth(), "Bearer " + tokenFor(newUser(false))))
                .andExpect(status().isNotFound());
    }

    private static String successBody(String prefix) {
        return successBody(prefix, true);
    }

    private static String successBody(String prefix, boolean includeRig) {
        return "{\"status\":\"SUCCEEDED\",\"meshObjectKey\":\""
                + prefix
                + "mesh.glb\","
                + (includeRig
                        ? "\"rigObjectKey\":\""
                                + prefix
                                + "rig.json\",\"expressionObjectKey\":\""
                                + prefix
                                + "expression.json\","
                        : "")
                + "\"thumbnailObjectKey\":\""
                + prefix
                + "thumbnail.webp\",\"meshFormat\":\"GLB\",\"morphSchemaVersion\":\"v1\","
                + "\"noseApproval\":{\"schemaVersion\":\"v1\",\"binding\":{"
                + "\"meshSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\","
                + "\"rigSha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\","
                + "\"fitSha\":\"synthetic\",\"engine\":\"synthetic\",\"rigVersion\":\"v1\","
                + "\"topologyVersion\":\"synthetic\"},\"ranges\":{"
                + "\"nose.bridge_height\":{\"min\":-0.1,\"max\":0.1},"
                + "\"nose.tip_projection\":{\"min\":-0.1,\"max\":0.1},"
                + "\"nose.tip_height\":{\"min\":-0.1,\"max\":0.1},"
                + "\"nose.tip_rotation\":{\"min\":-0.1,\"max\":0.1},"
                + "\"nose.alar_width\":{\"min\":-0.1,\"max\":0.1}}},"
                + "\"measurements\":{\"nose.bridge_height_mm\":9.8},"
                + "\"qualityReport\":{\"yawRangeDeg\":62},"
                + "\"videoMeta\":{\"width\":1080,\"height\":1920,\"fps\":30,\"codec\":\"hevc\","
                + "\"deviceModel\":\"Test-1\",\"gps\":\"37.0,127.0\",\"originalSuspect\":false},"
                + "\"durationMs\":212000,"
                + "\"captureImages\":{\"FRONT\":\""
                + prefix
                + "captures/front.jpg\",\"LEFT\":\""
                + prefix
                + "captures/left.jpg\",\"RIGHT\":\""
                + prefix
                + "captures/right.jpg\",\"LEFT_45\":\""
                + prefix
                + "captures/left_45.jpg\",\"RIGHT_45\":\""
                + prefix
                + "captures/right_45.jpg\"}}";
    }

    private String newUser(boolean faceConsent) {
        String id = UUID.randomUUID().toString();
        jdbc.update("insert into user(id, nickname, status) values (?, 'it', 'ACTIVE')", id);
        if (faceConsent) {
            String documentId =
                    jdbc.queryForObject(
                            "select id from consent_document where consent_type = 'FACE_DATA' and effective_at <= utc_timestamp() limit 1",
                            String.class);
            jdbc.update(
                    "insert into user_consent(id, user_id, consent_document_id, consent_type, agreed,"
                            + " acted_at) values (uuid(), ?, ?, 'FACE_DATA', 1, utc_timestamp(3))",
                    id,
                    documentId);
        }
        return id;
    }

    private String newUpload(String ownerId, String status) {
        String id = UUID.randomUUID().toString();
        jdbc.update(
                "insert into face_upload(id, user_id, object_key, content_type, size_bytes, duration_ms,"
                        + " status, url_expires_at, retention_expires_at, checksum_sha256)"
                        + " values (?, ?, ?, 'video/quicktime', 1000, 35000, ?,"
                        + " utc_timestamp() + interval 10 minute, utc_timestamp() + interval 1 day, ?)",
                id,
                ownerId,
                "users/" + ownerId + "/uploads/" + id + ".mov",
                status,
                CHECKSUM);
        return id;
    }

    private String tokenFor(String id) {
        return new JwtProvider(authProperties, Clock.systemUTC())
                .issue(id, TokenScope.USER, Duration.ofMinutes(30))
                .value();
    }

    private static String auth() {
        return HttpHeaders.AUTHORIZATION;
    }

    private String bearer() {
        return "Bearer " + accessToken;
    }

    private static ReconstructionStorage.PresignedUrl synthetic() {
        return new ReconstructionStorage.PresignedUrl(
                "https://storage.example.invalid/synthetic",
                Map.of("x-amz-server-side-encryption", "AES256"),
                Instant.now().plus(Duration.ofMinutes(10)));
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    }
}
