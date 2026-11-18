package com.preface.api.simulation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
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
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.service.EyeEditValidatorClient;
import com.preface.api.simulation.service.MorphEdits;
import com.preface.api.simulation.service.NoseEditService;
import com.preface.api.simulation.service.WeightContourValidatorClient;
import com.preface.api.simulation.service.WeightShapeModelApprovalService;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.user.entity.OAuthProvider;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Set;
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
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

/**
 * 시안 생성 → 슬라이더 → undo·redo·reset 흐름과 권한·충돌 에러를 실제 MySQL로 확인한다.
 *
 * <p>회원은 소셜 로그인·가입 API로 만든다(제공자 호출만 mock). 3D(face_model)는 복원 기능이 아직 없어 합성 행을 SQL로 넣는다.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class SimulationEditIT {

    private static final String REDIRECT = "http://localhost:3000/oauth/kakao";

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbcTemplate;

    @MockitoBean KakaoOAuthClient kakao;
    @MockitoBean GoogleOAuthClient google;
    @MockitoBean NoseEditService noseEditService;
    @MockitoBean ReconstructionStorage reconstructionStorage;
    @MockitoBean EyeEditValidatorClient eyeEditValidator;
    @MockitoBean WeightShapeModelApprovalService contourSupport;
    @MockitoBean WeightContourValidatorClient compositeValidator;

    private String providerUserId;

    @BeforeEach
    void setUp() {
        // 이 테스트는 이력과 동시성만 검증한다. 승인·메시 검사는 NoseEditServiceTest가 맡는다.
        when(reconstructionStorage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://synthetic.invalid/model",
                                java.util.Map.of(),
                                Instant.now().plusSeconds(600)));
        when(eyeEditValidator.validate(anyString(), anyString(), any(), any(), any()))
                .thenReturn(true);
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
    void 첫_비교_미리보기는_상태를_그대로_두고_적용_뒤_조회와_되돌리기를_지원한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId(), "SUCCEEDED");
        String simulation = createdSimulationId(me, model);
        String path = "/api/v1/simulations/" + simulation;

        mockMvc.perform(post(path + "/first-comparison").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.proposal").doesNotExist());

        String binding =
                """
                {"meshSha256":"%s","rigSha256":"%s","fitSha":"fit",
                 "engine":"engine","rigVersion":"rig","topologyVersion":"topology"}
                """
                        .formatted("a".repeat(64), "b".repeat(64));
        String approval =
                """
                {"schemaVersion":"v1","binding":%s}
                """
                        .formatted(binding);
        String measurements =
                """
                {"approvedBaselineReviewV1":{
                  "schemaVersion":"v1","binding":%s,
                  "review":{"meshSha256":"%s","definition":"alar-lateral-frontal-basal-v1",
                    "unit":"model-space","anatomicalQuality":"reviewed-pair",
                    "observedBounds":{"alarWidth":[0.034,0.036],"intercanthalDistance":[0.030,0.031]}}
                }}
                """
                        .formatted(binding, "a".repeat(64));
        jdbcTemplate.update(
                "update face_model set rig_object_key = 'fixture/rig.json', approved_nose_capabilities = ?, measurements = ? where id = ?",
                approval,
                measurements.replace("0.030,0.031", "0.030,0.034"),
                model);
        var bounds = new com.preface.api.simulation.dto.NoseCapabilities.Range(-0.1, 0.1);
        when(noseEditService.capabilities(any(Simulation.class), anyMap()))
                .thenReturn(
                        new com.preface.api.simulation.dto.NoseCapabilities(
                                "topology",
                                "rig",
                                "engine",
                                java.util.Map.of("nose.alar_width", bounds)));

        mockMvc.perform(post(path + "/first-comparison").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.proposal").doesNotExist());
        jdbcTemplate.update(
                "update face_model set measurements = ? where id = ?", measurements, model);
        when(noseEditService.validate(
                        any(Simulation.class),
                        anyMap(),
                        any(MorphEdits.Applied.class),
                        anyMap(),
                        any(),
                        eq(false)))
                .thenThrow(new BusinessException(EditErrorCode.UNSAFE_NOSE_EDIT))
                .thenAnswer(inv -> inv.getArgument(2));
        mockMvc.perform(post(path + "/first-comparison").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.proposal").doesNotExist());

        mockMvc.perform(post(path + "/first-comparison").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.proposal.stateVersion").value(0))
                .andExpect(jsonPath("$.data.proposal.code").value("nose.alar_width"))
                .andExpect(jsonPath("$.data.proposal.value").value(-0.05));
        mockMvc.perform(get(path).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(0))
                .andExpect(jsonPath("$.data.canUndo").value(false));

        slider(me, simulation, 0, "nose.alar_width", -0.05).andExpect(status().isOk());
        mockMvc.perform(get(path).headers(auth(me)))
                .andExpect(jsonPath("$.data.morphState.weights['nose.alar_width']").value(-0.05))
                .andExpect(jsonPath("$.data.canUndo").value(true));
        stateCommand(me, simulation, "undo", 1).andExpect(status().isOk());
        mockMvc.perform(get(path).headers(auth(me)))
                .andExpect(jsonPath("$.data.morphState.weights['nose.alar_width']").doesNotExist());
    }

    @Test
    void morph_파라미터는_로그인_없이_부위별로_조회된다() throws Exception {
        mockMvc.perform(get("/api/v1/morph-parameters").param("schemaVersion", "v1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.schemaVersion").value("v1"))
                .andExpect(jsonPath("$.data.parts[0].part").value("NOSE"))
                .andExpect(jsonPath("$.data.parts[0].label").value("코"))
                .andExpect(jsonPath("$.data.parts[0].items[0].code").value("nose.bridge_height"))
                .andExpect(jsonPath("$.data.parts[0].items[0].min").value(-1.0))
                .andExpect(jsonPath("$.data.parts[0].items[0].max").value(1.0))
                .andExpect(jsonPath("$.data.parts[0].items[0].default").value(0.0))
                .andExpect(jsonPath("$.data.parts[0].items[0].step").value(0.05))
                .andExpect(jsonPath("$.data.parts[0].items[1].code").value("nose.tip_height"))
                .andExpect(jsonPath("$.data.parts[0].items[1].min").value(-1.0))
                .andExpect(jsonPath("$.data.parts[0].items[1].max").value(1.0))
                .andExpect(jsonPath("$.data.parts[0].items[2].code").value("nose.tip_projection"))
                .andExpect(jsonPath("$.data.parts[0].items[3].code").value("nose.tip_rotation"))
                .andExpect(jsonPath("$.data.parts[0].items[4].code").value("nose.alar_width"))
                .andExpect(jsonPath("$.data.parts[0].items[4].min").value(-1.0))
                .andExpect(jsonPath("$.data.parts[0].items[4].max").value(1.0))
                .andExpect(jsonPath("$.data.parts[1].part").value("EYE"));
    }

    @Test
    void 시안을_만들고_슬라이더_undo_redo_reset이_이력대로_동작한다() throws Exception {
        Member me = newMember();
        String faceModelId = insertFaceModel(me.userId(), "SUCCEEDED");
        String today =
                LocalDate.now(ZoneId.of("Asia/Seoul"))
                        .format(DateTimeFormatter.ofPattern("yyyy.MM.dd"));

        MvcResult created =
                mockMvc.perform(createSimulation(me, faceModelId))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.data.title").value(today + " 시안"))
                        .andExpect(jsonPath("$.data.faceModelId").value(faceModelId))
                        .andExpect(jsonPath("$.data.morphState.schemaVersion").value("v1"))
                        .andExpect(jsonPath("$.data.stateVersion").value(0))
                        .andExpect(jsonPath("$.data.currentSeq").value(0))
                        .andExpect(jsonPath("$.data.canUndo").value(false))
                        .andExpect(jsonPath("$.data.canRedo").value(false))
                        .andExpect(jsonPath("$.data.hasChanges").value(false))
                        .andReturn();
        String id = JsonPath.read(body(created), "$.data.simulationId");
        mockMvc.perform(createSimulation(me, faceModelId))
                .andExpect(jsonPath("$.data.title").value(today + " 시안 2"));

        // 슬라이더 1: 범위 안
        slider(me, id, 0, "nose.bridge_height", 0.2)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.2))
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.currentSeq").value(1))
                .andExpect(jsonPath("$.data.clamped").value(false))
                .andExpect(jsonPath("$.data.canUndo").value(true))
                .andExpect(jsonPath("$.data.canRedo").value(false));
        // 슬라이더 2: 범위 밖 → clamp
        slider(me, id, 1, "nose.alar_width", 3.0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.alar_width']").value(1.0))
                .andExpect(jsonPath("$.data.clamped").value(true))
                .andExpect(jsonPath("$.data.currentSeq").value(2));

        // undo → seq 1 상태
        stateCommand(me, id, "undo", 2)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.alar_width']").doesNotExist())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.2))
                .andExpect(jsonPath("$.data.stateVersion").value(3))
                .andExpect(jsonPath("$.data.currentSeq").value(1))
                .andExpect(jsonPath("$.data.canRedo").value(true))
                .andExpect(jsonPath("$.data.undoneSummary").value("콧볼 너비 변경을 취소했어요."));
        // redo → seq 2 상태
        stateCommand(me, id, "redo", 3)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.alar_width']").value(1.0))
                .andExpect(jsonPath("$.data.currentSeq").value(2))
                .andExpect(jsonPath("$.data.canRedo").value(false))
                .andExpect(jsonPath("$.data.redoneSummary").value("콧볼 너비 변경을 다시 적용했어요."));

        // undo 후 새 변경 → redo 이력 삭제
        stateCommand(me, id, "undo", 4).andExpect(status().isOk());
        slider(me, id, 5, "nose.tip_height", -0.1)
                .andExpect(jsonPath("$.data.currentSeq").value(2))
                .andExpect(jsonPath("$.data.canRedo").value(false));
        stateCommand(me, id, "redo", 6)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_004"));

        // reset → 빈 가중치, undo로 복구
        stateCommand(me, id, "reset", 6)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty())
                .andExpect(jsonPath("$.data.currentSeq").value(3))
                .andExpect(jsonPath("$.data.canUndo").value(true));
        stateCommand(me, id, "undo", 7)
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_height']").value(-0.1))
                .andExpect(jsonPath("$.data.undoneSummary").value("초기화를 취소했어요."));

        // 다시 열면 같은 상태
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.2))
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_height']").value(-0.1))
                .andExpect(jsonPath("$.data.stateVersion").value(8))
                .andExpect(jsonPath("$.data.currentSeq").value(2))
                .andExpect(jsonPath("$.data.canUndo").value(true))
                .andExpect(jsonPath("$.data.canRedo").value(true))
                .andExpect(jsonPath("$.data.hasChanges").value(true))
                .andExpect(jsonPath("$.data.lastChangeRequest").isEmpty());

        assertThat(
                        jdbcTemplate.queryForList(
                                "select source from morph_change where simulation_id = ? order by seq",
                                String.class,
                                id))
                .containsExactly("INIT", "SLIDER", "SLIDER", "RESET");
        verifyNoInteractions(eyeEditValidator);
    }

    @Test
    void 눈_판정과_승인_후에만_눈_상태를_저장하고_코_편집_뒤에도_undo_redo로_복원한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId(), "SUCCEEDED");
        String id = createdSimulationId(me, model);
        EyeEditState initial = EyeEditState.initial();
        EyeEditState.EyeSettings adjusted =
                new EyeEditState.EyeSettings(
                        false,
                        "inout",
                        new EyeEditState.Values(20, 65, 15, 0, 0, 0),
                        initial.L().curve());
        EyeEditState eyes = new EyeEditState(adjusted, adjusted);
        String body =
                "{\"stateVersion\":0,\"eyeEdit\":"
                        + JsonMapper.builder().build().writeValueAsString(eyes)
                        + "}";

        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/eye-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));

        approveEyes(model);
        String parts = "c".repeat(64);
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(jsonPath("$.data.eyeReview.L").value("absent"))
                .andExpect(jsonPath("$.data.eyePartsSha256").value(parts))
                .andExpect(jsonPath("$.data.eyeCapabilities.limits.inner").value(20));
        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/eye-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(15))
                .andExpect(jsonPath("$.data.stateVersion").value(1));
        when(eyeEditValidator.validate(anyString(), anyString(), any(), any(), any()))
                .thenReturn(false);
        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/eye-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body.replace("\"stateVersion\":0", "\"stateVersion\":1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(1));
        when(eyeEditValidator.validate(anyString(), anyString(), any(), any(), any()))
                .thenReturn(true);
        slider(me, id, 1, "nose.bridge_height", 0.2)
                .andExpect(jsonPath("$.data.morphState.eyeEdit.R.values.inner").value(15));
        stateCommand(me, id, "undo", 2)
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(15));
        stateCommand(me, id, "undo", 3).andExpect(jsonPath("$.data.morphState.eyeEdit").isEmpty());
        stateCommand(me, id, "redo", 4)
                .andExpect(jsonPath("$.data.morphState.eyeEdit.R.values.inner").value(15));
        stateCommand(me, id, "reset", 5).andExpect(jsonPath("$.data.morphState.eyeEdit").isEmpty());
        stateCommand(me, id, "undo", 6)
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(15));
        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/eye-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_002"));
        Member other = newMember();
        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/eye-state")
                                .headers(auth(other))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(7))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(15));
    }

    @Test
    void 과거_불안전한_눈_상태는_코_슬라이더와_제어점_이력으로_다시_저장되지_않는다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId(), "SUCCEEDED");
        approveEyes(model);
        String id = createdSimulationId(me, model);
        EyeEditState initial = EyeEditState.initial();
        var adjusted =
                new EyeEditState.EyeSettings(
                        false,
                        "inout",
                        new EyeEditState.Values(20, 65, 15, 0, 0, 0),
                        initial.L().curve());
        String eyes =
                JsonMapper.builder()
                        .build()
                        .writeValueAsString(new EyeEditState(adjusted, adjusted));
        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/eye-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"stateVersion\":0,\"eyeEdit\":" + eyes + "}"))
                .andExpect(status().isOk());

        // 저장 뒤 새 검사에서 실패한 과거 상태를 합성한다.
        when(eyeEditValidator.validate(anyString(), anyString(), any(), any(), any()))
                .thenAnswer(
                        inv -> {
                            assertThat(
                                            TransactionSynchronizationManager
                                                    .isActualTransactionActive())
                                    .isFalse();
                            return false;
                        });
        slider(me, id, 1, "nose.bridge_height", 0.1)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/point-strokes")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":1,\"pointStrokes\":[{\"vertex\":3,\"delta\":[0,0.01,0]}]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.currentSeq").value(1))
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                id))
                .isEqualTo(2);

        stateCommand(me, id, "reset", 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.eyeEdit").isEmpty());
        stateCommand(me, id, "undo", 2)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        slider(me, id, 2, "nose.bridge_height", 0.1).andExpect(status().isOk());
    }

    @Test
    void 옛_코끝_복합_이력의_undo_redo_안내도_슬라이더_두_항목으로_보인다() throws Exception {
        Member me = newMember();
        String id = createdSimulationId(me, insertFaceModel(me.userId(), "SUCCEEDED"));
        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"stateVersion":0,"changes":[
                                          {"code":"nose.tip_height","value":-0.24},
                                          {"code":"nose.tip_rotation","value":-0.16},
                                          {"code":"nose.alar_width","value":-0.4}
                                        ]}
                                        """))
                .andExpect(status().isOk());
        jdbcTemplate.update(
                "update morph_change set summary = ? where simulation_id = ? and seq = 1",
                "코끝 외 2개 변경",
                id);

        stateCommand(me, id, "undo", 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.undoneSummary").value("콧볼 너비, 코끝 위아래 변경을 취소했어요."));
        stateCommand(me, id, "redo", 2)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.redoneSummary").value("콧볼 너비, 코끝 위아래 변경을 다시 적용했어요."));
    }

    @Test
    void 코_제어점_한번_이동은_시안에_저장되고_재조회_undo_redo로_복원된다() throws Exception {
        when(noseEditService.validatePoints(
                        any(Simulation.class), anyMap(), any(), any(), anyMap()))
                .thenAnswer(inv -> inv.getArgument(3));
        Member me = newMember();
        String id = createdSimulationId(me, insertFaceModel(me.userId(), "SUCCEEDED"));
        String point =
                "{\"stateVersion\":0,\"pointStrokes\":[{\"vertex\":3,\"delta\":[0,0.01,0]}]}";

        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/point-strokes")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(point))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.pointStrokes[0].vertex").value(3))
                .andExpect(jsonPath("$.data.stateVersion").value(1));
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(jsonPath("$.data.morphState.pointStrokes[0].delta[1]").value(0.01));
        stateCommand(me, id, "undo", 1)
                .andExpect(jsonPath("$.data.morphState.pointStrokes").isEmpty());
        stateCommand(me, id, "redo", 2)
                .andExpect(jsonPath("$.data.morphState.pointStrokes[0].vertex").value(3));
    }

    @Test
    void 되돌리기는_최대_50단계까지만_된다() throws Exception {
        Member me = newMember();
        String id = createdSimulationId(me, insertFaceModel(me.userId(), "SUCCEEDED"));

        int version = 0;
        for (int i = 1; i <= 51; i++) {
            slider(me, id, version++, "nose.bridge_height", i % 2 == 0 ? 0.1 : 0.2)
                    .andExpect(status().isOk());
        }
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                id))
                .as("현재 + 되돌릴 50단계")
                .isEqualTo(51);

        for (int i = 0; i < 50; i++) {
            stateCommand(me, id, "undo", version++).andExpect(status().isOk());
        }
        stateCommand(me, id, "undo", version)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_003"));
    }

    @Test
    void 윤곽_슬라이더는_저장_undo_redo되고_초기화에서_코와_함께_지워진다() throws Exception {
        mockMvc.perform(get("/api/v1/morph-parameters").param("schemaVersion", "v1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.parts[2].part").value("CONTOUR"))
                .andExpect(jsonPath("$.data.parts[2].label").value("윤곽"))
                .andExpect(jsonPath("$.data.parts[2].items[0].code").value("contour.cheekbone"))
                .andExpect(jsonPath("$.data.parts[2].items[0].step").value(0.01))
                .andExpect(jsonPath("$.data.parts[2].items.length()").value(7));
        Member me = newMember();
        String id = createdSimulationId(me, insertFaceModel(me.userId(), "SUCCEEDED"));

        when(contourSupport.supportedContourCodes(any())).thenReturn(Set.of("contour.jaw_angle"));
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.editRanges.weights['contour.jaw_angle'].min").value(-1))
                .andExpect(
                        jsonPath("$.data.editRanges.weights['contour.cheekbone']").doesNotExist());
        slider(me, id, 0, "contour.cheekbone", 0.2)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        slider(me, id, 0, "nose.bridge_height", 0.2).andExpect(status().isOk());
        slider(me, id, 1, "contour.jaw_angle", -1.5)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['contour.jaw_angle']").value(-1.0))
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.2))
                .andExpect(jsonPath("$.data.clamped").value(true));
        stateCommand(me, id, "undo", 2)
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.jaw_angle']").doesNotExist())
                .andExpect(jsonPath("$.data.undoneSummary").value("사각턱 변경을 취소했어요."));
        stateCommand(me, id, "redo", 3)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['contour.jaw_angle']").value(-1.0));
        stateCommand(me, id, "reset", 4)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty());
        stateCommand(me, id, "undo", 5)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['contour.jaw_angle']").value(-1.0));
    }

    @Test
    void 모르는_code는_EDIT_001_버전이_다르면_EDIT_002_이력이_없으면_EDIT_003() throws Exception {
        Member me = newMember();
        String id = createdSimulationId(me, insertFaceModel(me.userId(), "SUCCEEDED"));

        slider(me, id, 0, "contour.jaw_width", 0.1)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        slider(me, id, 7, "nose.bridge_height", 0.1)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_002"));
        stateCommand(me, id, "undo", 0)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_003"));
        mockMvc.perform(
                        patch("/api/v1/simulations/" + id + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"changes\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                id))
                .as("실패한 요청은 이력을 남기지 않는다")
                .isEqualTo(1);
    }

    @Test
    void 체중_방향_얼굴형은_모델_승인_후에만_단독으로_저장하고_undo_redo한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId(), "SUCCEEDED");
        String id = createdSimulationId(me, model);

        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(jsonPath("$.data.weightShapeSupported").value(false));
        slider(me, id, 0, "contour.weight_shape", 0.4)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        approveWeightShape(model);
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(jsonPath("$.data.weightShapeSupported").value(true));
        slider(me, id, 0, "contour.weight_shape", -0.4)
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']").value(-0.4));
        slider(me, id, 1, "nose.bridge_height", 0.2)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        stateCommand(me, id, "undo", 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty());
        stateCommand(me, id, "redo", 2)
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']").value(-0.4));
        stateCommand(me, id, "reset", 3)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty());
        stateCommand(me, id, "undo", 4)
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']").value(-0.4));
        jdbcTemplate.update(
                "update face_model set approved_weight_shape = null where id = ?", model);
        stateCommand(me, id, "redo", 5).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(jsonPath("$.data.weightShapeSupported").value(false))
                .andExpect(jsonPath("$.data.canUndo").value(false));
        stateCommand(me, id, "undo", 6)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
    }

    @Test
    void 새_복합_조절을_거절하고_기존_복합_이력은_형상_검사_후_복원한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId(), "SUCCEEDED");
        String id = createdSimulationId(me, model);
        approveWeightShape(model);
        when(contourSupport.supportedContourCodes(any()))
                .thenReturn(Set.of("contour.cheek_volume"));
        when(compositeValidator.validate(anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(true);

        compositeSlider(me, id, 0, -0.4, 0.2)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        slider(me, id, 0, "contour.weight_shape", -0.4).andExpect(status().isOk());
        slider(me, id, 1, "contour.cheek_volume", 0.2)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));

        String legacy =
                "{\"schemaVersion\":\"v1\",\"weights\":{\"contour.weight_shape\":-0.4,\"contour.cheek_volume\":0.2}}";
        jdbcTemplate.update("update simulation set morph_state = ? where id = ?", legacy, id);
        jdbcTemplate.update(
                "update morph_change set state_after = ? where simulation_id = ? and seq = 1",
                legacy,
                id);
        stateCommand(me, id, "reset", 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty());
        stateCommand(me, id, "undo", 2)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['contour.cheek_volume']").value(0.2))
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']").value(-0.4));
        stateCommand(me, id, "redo", 3).andExpect(status().isOk());
        when(compositeValidator.validate(anyString(), anyString(), anyString(), anyMap()))
                .thenReturn(false);
        stateCommand(me, id, "undo", 4)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
    }

    @Test
    void 직접_눈_편집은_활성_코드여도_거절하고_기존_눈_상태는_초기화에서도_보존한다() throws Exception {
        Member me = newMember();
        String id = createdSimulationId(me, insertFaceModel(me.userId(), "SUCCEEDED"));

        slider(me, id, 0, "eye.size", 0.2)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                id))
                .isEqualTo(1);

        String legacy =
                "{\"schemaVersion\":\"v1\",\"weights\":{\"eye.size\":0.2,\"nose.bridge_height\":0.3}}";
        jdbcTemplate.update("update simulation set morph_state = ? where id = ?", legacy, id);
        stateCommand(me, id, "reset", 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['eye.size']").value(0.2))
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.bridge_height']").doesNotExist())
                .andExpect(jsonPath("$.data.canUndo").value(false));
        stateCommand(me, id, "undo", 1)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        slider(me, id, 1, "eye.size", 0.0)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                id))
                .isEqualTo(2);

        // 기존 눈 이력을 가리키는 redo도 버튼을 활성화하지 않는다.
        jdbcTemplate.update(
                "update simulation set current_seq = 0, morph_state = ? where id = ?",
                "{\"schemaVersion\":\"v1\",\"weights\":{}}",
                id);
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.canRedo").value(false));
        stateCommand(me, id, "redo", 1)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
    }

    @Test
    void 남의_시안과_남의_3D는_COMMON_002_404다() throws Exception {
        Member owner = newMember();
        Member other = newMember();
        String faceModelId = insertFaceModel(owner.userId(), "SUCCEEDED");
        String id = createdSimulationId(owner, faceModelId);

        mockMvc.perform(createSimulation(other, faceModelId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(get("/api/v1/simulations/" + id).headers(auth(other)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        slider(other, id, 0, "nose.bridge_height", 0.1)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        for (String command : List.of("undo", "redo", "reset")) {
            stateCommand(other, id, command, 0)
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        }
    }

    @Test
    void 변경_시안을_삭제해도_원본_3D와_다른_시안은_남는다() throws Exception {
        Member me = newMember();
        String faceModelId = insertFaceModel(me.userId(), "SUCCEEDED");
        String deletedId = createdSimulationId(me, faceModelId);
        String remainingId = createdSimulationId(me, faceModelId);
        String originalKey =
                jdbcTemplate.queryForObject(
                        "select mesh_object_key from face_model where id = ?",
                        String.class,
                        faceModelId);

        slider(me, deletedId, 0, "nose.bridge_height", 0.2).andExpect(status().isOk());
        mockMvc.perform(delete("/api/v1/simulations/" + deletedId).headers(auth(me)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/simulations/" + deletedId).headers(auth(me)))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/simulations/" + remainingId).headers(auth(me)))
                .andExpect(status().isOk());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select mesh_object_key from face_model where id = ? and deleted_at is null",
                                String.class,
                                faceModelId))
                .isEqualTo(originalKey);
    }

    @Test
    void 복원이_끝나지_않은_3D는_EDIT_020_삭제_중인_3D는_HIS_002다() throws Exception {
        Member me = newMember();
        String running = insertFaceModel(me.userId(), "RUNNING");
        String deleted = insertFaceModel(me.userId(), "SUCCEEDED");
        jdbcTemplate.update("update face_model set deleted_at = now() where id = ?", deleted);

        mockMvc.perform(createSimulation(me, running))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_020"));
        mockMvc.perform(createSimulation(me, deleted))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("HIS_002"));
    }

    @Test
    void 로그인하지_않으면_시안_API는_AUTH_001이다() throws Exception {
        mockMvc.perform(get("/api/v1/simulations/" + UUID.randomUUID()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_001"));
    }

    // ---- 도우미 ----

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

    /** 합성 3D 한 개(업로드·복원 작업·모델 행). 실제 파일은 없다. */
    private String insertFaceModel(String userId, String jobStatus) {
        String uploadId = UUID.randomUUID().toString();
        String jobId = UUID.randomUUID().toString();
        String faceModelId = UUID.randomUUID().toString();
        Timestamp now = Timestamp.from(Instant.now());
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
                        + " values (?, ?, ?, ?)",
                jobId,
                userId,
                uploadId,
                jobStatus);
        jdbcTemplate.update(
                "insert into face_model(id, user_id, reconstruction_job_id, mesh_object_key,"
                        + " morph_schema_version) values (?, ?, ?, ?, 'v1')",
                faceModelId,
                userId,
                jobId,
                "users/" + userId + "/models/" + jobId + "/mesh.glb");
        return faceModelId;
    }

    private void approveEyes(String model) {
        String mesh = "a".repeat(64);
        String rig = "b".repeat(64);
        String parts = "c".repeat(64);
        jdbcTemplate.update(
                "update face_model set eye_review = ?, eye_parts_sha256 = ?, rig_object_key = ?,"
                        + " approved_nose_capabilities = ?, approved_eye_capabilities = ? where id = ?",
                "{\"L\":\"absent\",\"R\":\"absent\"}",
                parts,
                "synthetic/rig.json",
                "{\"schemaVersion\":\"v1\",\"binding\":{\"meshSha256\":\""
                        + mesh
                        + "\",\"rigSha256\":\""
                        + rig
                        + "\",\"fitSha\":\"fit\",\"engine\":\"v1\",\"rigVersion\":\"v1\",\"topologyVersion\":\"v1\"},\"ranges\":{}}",
                "{\"schemaVersion\":\"v1\",\"meshSha256\":\""
                        + mesh
                        + "\",\"rigSha256\":\""
                        + rig
                        + "\",\"eyePartsSha256\":\""
                        + parts
                        + "\",\"engine\":\"v1\",\"rigVersion\":\"v1\",\"topologyVersion\":\"v1\",\"limits\":{\"inner\":20,\"outer\":20,\"lower\":20,\"upper\":20,\"inout:height\":40}}",
                model);
    }

    private void approveWeightShape(String model) {
        String mesh = "a".repeat(64);
        String fit = "c".repeat(12);
        jdbcTemplate.update(
                "update face_model set approved_nose_capabilities = ?, approved_weight_shape = ? where id = ?",
                "{\"schemaVersion\":\"v1\",\"binding\":{\"meshSha256\":\""
                        + mesh
                        + "\",\"rigSha256\":\""
                        + "b".repeat(64)
                        + "\",\"fitSha\":\""
                        + fit
                        + "\",\"engine\":\"v1\",\"rigVersion\":\"v1\",\"topologyVersion\":\"v1\"},\"ranges\":{}}",
                "{\"version\":1,\"meshSha256\":\""
                        + mesh
                        + "\",\"fitSha\":\""
                        + fit
                        + "\",\"modelVersion\":1,\"negativeLimit\":1,\"positiveLimit\":1}",
                model);
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

    private ResultActions slider(
            Member member, String simulationId, int stateVersion, String code, double value)
            throws Exception {
        return mockMvc.perform(
                patch("/api/v1/simulations/" + simulationId + "/morph-state")
                        .headers(auth(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                "{\"stateVersion\":"
                                        + stateVersion
                                        + ",\"changes\":[{\"code\":\""
                                        + code
                                        + "\",\"value\":"
                                        + value
                                        + "}]}"));
    }

    private ResultActions compositeSlider(
            Member member, String simulationId, int stateVersion, double weight, double contour)
            throws Exception {
        return mockMvc.perform(
                patch("/api/v1/simulations/" + simulationId + "/morph-state")
                        .headers(auth(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                "{\"stateVersion\":"
                                        + stateVersion
                                        + ",\"changes\":[{\"code\":\"contour.weight_shape\",\"value\":"
                                        + weight
                                        + "},{\"code\":\"contour.cheek_volume\",\"value\":"
                                        + contour
                                        + "}]}"));
    }

    private ResultActions stateCommand(
            Member member, String simulationId, String command, int stateVersion) throws Exception {
        return mockMvc.perform(
                post("/api/v1/simulations/" + simulationId + "/" + command)
                        .headers(auth(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"stateVersion\":" + stateVersion + "}"));
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
