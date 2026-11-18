package com.preface.api.consult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
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
import com.preface.api.simulation.dto.NoseCapabilities;
import com.preface.api.simulation.service.EyeEditValidatorClient;
import com.preface.api.simulation.service.MorphEdits;
import com.preface.api.simulation.service.MorphRange;
import com.preface.api.simulation.service.NoseEditService;
import com.preface.api.simulation.service.WeightContourEditService;
import com.preface.api.simulation.service.WeightContourValidatorClient;
import com.preface.api.simulation.service.WeightShapeModelApprovalService;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.user.entity.OAuthProvider;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvFileSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

/**
 * 상담 메시지(CON-01·02) → 변경 요청 반영(EDIT-05) 흐름을 실제 MySQL로 확인한다. GMS는 {@link FakeAiServer}가 대신 답한다.
 *
 * <p>3D(face_model)는 v2 효과 카탈로그(V5)를 쓰도록 {@code morph_schema_version='v2'} 합성 행을 SQL로 넣는다.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ConsultFlowIT {

    @Test
    void 새_대화는_기존_편집과_상담을_보관하고_이전_후보의_적용을_차단한다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId(), false));
        MvcResult edited =
                send(me, simId, "{\"content\":\"광대를 키워줘\"}").andExpect(status().isOk()).andReturn();
        apply(me, simId, JsonPath.read(body(edited), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk());
        MvcResult pending =
                send(me, simId, "{\"content\":\"광대를 줄여줘\"}").andExpect(status().isOk()).andReturn();
        String pendingId = JsonPath.read(body(pending), "$.data.changeRequest.requestId");
        mockMvc.perform(
                        post("/api/v1/simulations/" + simId + "/messages/new-conversation")
                                .headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.conversationAfterSeq").value(4));
        mockMvc.perform(get("/api/v1/simulations/" + simId + "/messages").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(0));
        mockMvc.perform(
                        get("/api/v1/simulations/" + simId + "/messages?archived=true")
                                .headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(4));
        apply(me, simId, pendingId, 1).andExpect(status().is4xxClientError());
        send(me, simId, "{\"content\":\"더\",\"conversationAfterSeq\":0}")
                .andExpect(status().is4xxClientError());
        send(me, simId, "{\"content\":\"더\",\"conversationAfterSeq\":4}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(jsonPath("$.data.morphState.weights['contour.cheekbone']").value(0.1))
                .andExpect(jsonPath("$.data.stateVersion").value(1));
    }

    @Test
    void 체중_승인과_코_채팅이_없는_모델도_검증된_윤곽은_채팅으로_저장하고_undo한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId(), false);
        String simId = createdSimulationId(me, model);

        MvcResult contour =
                send(me, simId, "{\"content\":\"광대를 키워줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("contour.cheekbone"))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(contour), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['contour.cheekbone']").value(0.1));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(jsonPath("$.data.morphState.weights['contour.cheekbone']").value(0.1));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(0));
        send(me, simId, "{\"content\":\"체중 변화를 감량해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
    }

    @Test
    void 윤곽과_체중의_금지_지시는_기존_값과_편집_이력을_유지한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveWeightShape(model);
        String simId = createdSimulationId(me, model);

        for (String content :
                List.of("광대를 작게 하지 말아줘", "감량 방향으로 체중 조절하지 말아줘", "광대를 조절하면 어떤 모습이 되나요?")) {
            send(me, simId, "{\"content\":\"" + content + "\"}")
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                    .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        }
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(0))
                .andExpect(jsonPath("$.data.canUndo").value(false))
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty());

        MvcResult contour =
                send(me, simId, "{\"content\":\"볼살은 그대로 두고 광대만 조금 줄여줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.changeRequest.actions.length()").value(1))
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("contour.cheekbone"))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(contour), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['contour.cheekbone']").value(-0.1))
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.cheek_volume']")
                                .doesNotExist());
    }

    @Test
    void 기본_모델_채팅은_비로그인에게_닫히고_회원에게_답하되_시안을_저장하지_않는다() throws Exception {
        String path = "/api/v1/sample-models/base-male/consult";
        String body =
                "{\"content\":\"광대를 키워줘\",\"requestId\":\""
                        + UUID.randomUUID()
                        + "\",\"meshSha256\":\"c856a88dd70667f9be3e17c5eaa3d65760eedfd504a7bf4319ec6ca31bbca1c5\","
                        + "\"weights\":{},\"supportedCodes\":[\"contour.cheekbone\"],"
                        + "\"eyeAvailable\":false,\"eyeFoldEnabled\":false,\"eyeEdited\":false}";
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());

        Member me = newMember();
        int before = jdbcTemplate.queryForObject("select count(*) from simulation", Integer.class);
        int messages =
                jdbcTemplate.queryForObject("select count(*) from consult_message", Integer.class);
        mockMvc.perform(
                        post(path)
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.intent").value("EDIT"))
                .andExpect(
                        jsonPath("$.data.changeRequest.actions[0].code")
                                .value("contour.cheekbone"));
        assertThat(jdbcTemplate.queryForObject("select count(*) from simulation", Integer.class))
                .isEqualTo(before);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from consult_message", Integer.class))
                .isEqualTo(messages);
    }

    @Test
    void 체중과_윤곽은_상담에서_각각_저장할_수_있지만_전환_없이_함께_적용하지_않는다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveWeightShape(model);
        String simId = createdSimulationId(me, model);
        send(me, simId, "{\"content\":\"체중 변화를 감량하고 광대를 조금 키워줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        MvcResult weight =
                send(me, simId, "{\"content\":\"체중 변화를 감량해줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("contour.weight_shape"))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(weight), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']").value(-0.1));
        send(me, simId, "{\"content\":\"광대를 키워줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty())
                .andExpect(
                        jsonPath("$.data.assistantMessage.content")
                                .value(org.hamcrest.Matchers.containsString("전환")));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']").value(-0.1));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(0));
        MvcResult contour =
                send(me, simId, "{\"content\":\"광대를 키워줘\"}").andExpect(status().isOk()).andReturn();
        apply(me, simId, JsonPath.read(body(contour), "$.data.changeRequest.requestId"), 2)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['contour.cheekbone']").value(0.1));
        send(me, simId, "{\"content\":\"체중 변화를 감량해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
    }

    @Test
    void 체중_값이_있으면_눈_채팅을_안내하고_체중을_되돌린_뒤_눈을_저장한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        approveWeightShape(model);
        String simId = createdSimulationId(me, model);
        MvcResult weight = send(me, simId, "{\"content\":\"살을 빼줘\"}").andReturn();
        apply(me, simId, JsonPath.read(body(weight), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk());

        send(me, simId, "{\"content\":\"앞트임을 해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty())
                .andExpect(
                        jsonPath("$.data.assistantMessage.content")
                                .value(org.hamcrest.Matchers.containsString("전환")));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']").value(-0.1));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(0));

        MvcResult eye =
                send(me, simId, "{\"content\":\"앞트임을 해줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code").value("eye.inner"))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(eye), "$.data.changeRequest.requestId"), 2)
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']")
                                .doesNotExist())
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(2.0));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['contour.weight_shape']")
                                .doesNotExist())
                .andExpect(jsonPath("$.data.morphResult.morphState.eyeEdit").isEmpty());
        verifyNoInteractions(weightContourValidator);
    }

    @Test
    void GLB에_없는_윤곽은_채팅_후보와_저장을_막고_시안_이력을_보존한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveWeightShape(model);
        String simId = createdSimulationId(me, model);

        when(weightShapeApproval.supportedContourCodes(any())).thenReturn(java.util.Set.of());
        send(me, simId, "{\"content\":\"광대를 키워줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty())
                .andExpect(
                        jsonPath("$.data.assistantMessage.content")
                                .value(org.hamcrest.Matchers.containsString("사용할 수 없어요")));

        when(weightShapeApproval.supportedContourCodes(any()))
                .thenReturn(java.util.Set.of("contour.cheekbone"));
        MvcResult pending =
                send(me, simId, "{\"content\":\"광대를 키워줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("contour.cheekbone"))
                        .andReturn();
        when(weightShapeApproval.supportedContourCodes(any())).thenReturn(java.util.Set.of());
        apply(me, simId, JsonPath.read(body(pending), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isConflict());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(0))
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.cheekbone']").doesNotExist());
    }

    @Test
    void 눈_판정이_없는_기존_모델은_눈_상담을_적용하지_않고_코_상담은_유지한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        String simId = createdSimulationId(me, model);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select eye_review from face_model where id = ?",
                                String.class,
                                model))
                .isNull();

        send(me, simId, "{\"content\":\"앞트임을 조금 해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        assertThat(AI.bodies()).isEmpty();
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(0))
                .andExpect(jsonPath("$.data.currentSeq").value(0))
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty())
                .andExpect(jsonPath("$.data.morphState.eyeEdit").doesNotExist());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                simId))
                .isEqualTo(1);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from change_request where simulation_id = ?",
                                Integer.class,
                                simId))
                .isZero();

        String requestId = sendEdit(me, simId);
        apply(me, simId, requestId, 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.1))
                .andExpect(jsonPath("$.data.morphState.eyeEdit").doesNotExist());
    }

    @Test
    void 과거_불안전한_눈_상태는_코만_상담해도_새_이력으로_저장되지_않는다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        String simId = createdSimulationId(me, model);
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
                        patch("/api/v1/simulations/" + simId + "/eye-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"stateVersion\":0,\"eyeEdit\":" + eyes + "}"))
                .andExpect(status().isOk());

        when(eyeEditValidator.validate(anyString(), anyString(), any(), any(), any()))
                .thenAnswer(
                        inv -> {
                            assertThat(
                                            TransactionSynchronizationManager
                                                    .isActualTransactionActive())
                                    .isFalse();
                            return false;
                        });
        String text = "콧대를 조금 높여줘";
        AI.respond(
                200,
                FakeAiServer.edit(
                        text,
                        "[{\"code\":\"nose.bridge_height\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\",\"source\":\"콧대를 조금 높여줘\"}]",
                        "[]"));
        MvcResult sent = send(me, simId, "{\"content\":\"" + text + "\"}").andReturn();
        String requestId = JsonPath.read(body(sent), "$.data.changeRequest.requestId");
        apply(me, simId, requestId, 1)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("EDIT_001"));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.currentSeq").value(1))
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                simId))
                .isEqualTo(2);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select status from change_request where id = ?",
                                String.class,
                                requestId))
                .isEqualTo("COMPLETE");

        when(eyeEditValidator.validate(anyString(), anyString(), any(), any(), any()))
                .thenReturn(true);
        apply(me, simId, requestId, 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(2))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(15));
    }

    @Test
    void 승인된_눈과_코_상담은_한_거래로_저장되고_재조회와_undo가_같은_눈_상태를_복원한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        String simId = createdSimulationId(me, model);
        String text = "콧대를 높이고 눈도 앞트임 해줘";
        AI.respond(
                200,
                FakeAiServer.edit(
                        text,
                        "[{\"code\":\"nose.bridge_height\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\",\"source\":\"콧대를 높이고\"},"
                                + "{\"code\":\"eye.inner\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\",\"source\":\"눈도 앞트임 해줘\"}]",
                        "[]"));
        MvcResult sent =
                send(me, simId, "{\"content\":\"" + text + "\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.changeRequest.actions.length()").value(2))
                        .andReturn();
        String requestId = JsonPath.read(body(sent), "$.data.changeRequest.requestId");
        apply(me, simId, requestId, 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.seq").value(1))
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.1))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(2.0))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.R.values.inner").value(2.0))
                .andExpect(jsonPath("$.data.summary").value("콧대 높이, 앞트임 변경"))
                .andExpect(jsonPath("$.data.eyeBefore.L.values.inner").value(0.0))
                .andExpect(jsonPath("$.data.eyeAfter.L.values.inner").value(2.0))
                .andExpect(jsonPath("$.data.eyeLimits.inner").value(20.0));
        mockMvc.perform(get("/api/v1/simulations/" + simId + "/messages").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.items[1].applyResult.eyeAfter.R.values.inner").value(2.0));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(0));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.bridge_height']").doesNotExist())
                .andExpect(jsonPath("$.data.morphState.eyeEdit").doesNotExist());
    }

    @Test
    void 상담_후_눈_승인이_사라지면_코와_눈을_모두_저장하지_않는다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        String simId = createdSimulationId(me, model);
        String text = "콧대를 높이고 눈도 앞트임 해줘";
        AI.respond(
                200,
                FakeAiServer.edit(
                        text,
                        "[{\"code\":\"nose.bridge_height\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\",\"source\":\"콧대를 높이고\"},"
                                + "{\"code\":\"eye.inner\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\",\"source\":\"눈도 앞트임 해줘\"}]",
                        "[]"));
        MvcResult sent = send(me, simId, "{\"content\":\"" + text + "\"}").andReturn();
        jdbcTemplate.update(
                "update face_model set approved_eye_capabilities = null where id = ?", model);
        apply(me, simId, JsonPath.read(body(sent), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isConflict());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(0))
                .andExpect(jsonPath("$.data.currentSeq").value(0))
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.bridge_height']").doesNotExist());
    }

    @Test
    void 앞트임이_한계이면_혼합_상담을_보류하고_빈_이력을_만들지_않는다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        String simId = createdSimulationId(me, model);
        EyeEditState initial = EyeEditState.initial();
        var values = new EyeEditState.Values(20, 65, 20, 0, 0, 0);
        var one = new EyeEditState.EyeSettings(false, "inout", values, initial.L().curve());
        String eyes = JsonMapper.builder().build().writeValueAsString(new EyeEditState(one, one));
        mockMvc.perform(
                        patch("/api/v1/simulations/" + simId + "/eye-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"stateVersion\":0,\"eyeEdit\":" + eyes + "}"))
                .andExpect(status().isOk());

        String text = "콧대를 높이고 눈도 앞트임 해줘";
        AI.respond(
                200,
                FakeAiServer.edit(
                        text,
                        "[{\"code\":\"nose.bridge_height\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\",\"source\":\"콧대를 높이고\"},"
                                + "{\"code\":\"eye.inner\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\",\"source\":\"눈도 앞트임 해줘\"}]",
                        "[]"));
        MvcResult sent = send(me, simId, "{\"content\":\"" + text + "\"}").andReturn();
        apply(me, simId, JsonPath.read(body(sent), "$.data.changeRequest.requestId"), 1)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_033"));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.bridge_height']").doesNotExist())
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(20.0));

        int historyBeforeRetry =
                jdbcTemplate.queryForObject(
                        "select count(*) from morph_change where simulation_id = ?",
                        Integer.class,
                        simId);

        MvcResult eyeOnly =
                send(me, simId, "{\"content\":\"앞트임을 해줘\"}").andExpect(status().isOk()).andReturn();
        apply(me, simId, JsonPath.read(body(eyeOnly), "$.data.changeRequest.requestId"), 1)
                .andExpect(status().isConflict());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                simId))
                .isEqualTo(historyBeforeRetry);
    }

    @Test
    void 쌍꺼풀_모양_적용_뒤_더_덜은_모양을_임의로_바꾸지_않는다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        String simId = createdSimulationId(me, model);
        MvcResult sent =
                send(me, simId, "{\"content\":\"인아웃 쌍꺼풀로 바꿔줘\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(sent), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.style").value("inout"))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.enabled").value(true));
        send(me, simId, "{\"content\":\"조금 더\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.currentSeq").value(1));
    }

    @Test
    void 모드_전환과_후속_조절은_이력_한_건이며_적용할_후보가_없으면_그대로_둔다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        approveWeightShape(model);
        String simId = createdSimulationId(me, model);

        MvcResult face =
                send(me, simId, "{\"content\":\"광대 크기를 10으로 맞춰줘\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(face), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk());

        MvcResult weight =
                send(me, simId, switchRequest("체중 변화 강도를 -20으로 맞춰줘", "toWeight", 1))
                        .andExpect(status().isOk())
                        .andReturn();
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(jsonPath("$.data.currentSeq").value(1))
                .andExpect(jsonPath("$.data.morphState.weights['contour.cheekbone']").value(0.1));
        apply(me, simId, JsonPath.read(body(weight), "$.data.changeRequest.requestId"), 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.currentSeq").value(2))
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']").value(-0.2))
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.cheekbone']").doesNotExist());

        send(me, simId, "{\"content\":\"되돌려줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(1))
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['contour.cheekbone']")
                                .value(0.1));
        MvcResult redo =
                send(me, simId, "{\"content\":\"다시 실행\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.morphResult.currentSeq").value(2))
                        .andReturn();
        int version = JsonPath.read(body(redo), "$.data.morphResult.stateVersion");

        send(me, simId, switchRequest("체중 변화 강도를 10으로 맞춰줘", "toFace", version))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(jsonPath("$.data.currentSeq").value(2))
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']").value(-0.2));

        MvcResult eye =
                send(me, simId, switchRequest("앞트임을 50으로 맞춰줘", "toFace", version))
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(eye), "$.data.changeRequest.requestId"), version)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.currentSeq").value(3))
                .andExpect(
                        jsonPath("$.data.morphState.weights['contour.weight_shape']")
                                .doesNotExist())
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(10.0));
        send(me, simId, "{\"content\":\"되돌려줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(2))
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['contour.weight_shape']")
                                .value(-0.2))
                .andExpect(jsonPath("$.data.morphResult.morphState.eyeEdit").isEmpty());
    }

    private static String switchRequest(String content, String target, int version) {
        return """
                {"content":"%s","modeSwitch":{"target":"%s","stateVersion":%d}}
                """
                .formatted(content, target, version);
    }

    @Test
    void 눈_수치와_쌍꺼풀_끄기를_저장하고_채팅_초기화를_되돌린다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        String simId = createdSimulationId(me, model);
        List<String> commands = List.of("인아웃 쌍꺼풀로 바꿔줘", "앞트임을 50으로 맞춰줘", "쌍꺼풀을 없애줘");
        for (int i = 0; i < commands.size(); i++) {
            MvcResult sent =
                    send(me, simId, "{\"content\":\"" + commands.get(i) + "\"}")
                            .andExpect(status().isOk())
                            .andReturn();
            apply(me, simId, JsonPath.read(body(sent), "$.data.changeRequest.requestId"), i)
                    .andExpect(status().isOk());
        }
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(3))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.enabled").value(false))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(10.0));
        send(me, simId, "{\"content\":\"처음으로\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("RESET"));
        send(me, simId, "{\"content\":\"되돌려줘\"}")
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.eyeEdit.L.values.inner")
                                .value(10.0));
    }

    @Test
    void 쌍꺼풀_모양과_높이를_한_요청으로_적용하고_함께_되돌린다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        String simId = createdSimulationId(me, model);
        MvcResult sent =
                send(me, simId, "{\"content\":\"쌍꺼풀을 인아웃으로 만들고 높이를 조금 올려줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.changeRequest.actions.length()").value(2))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(sent), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.style").value("inout"))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.height").value(24));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.currentSeq").value(1))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.R.values.height").value(24));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.morphState.eyeEdit").isEmpty());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.currentSeq").value(0))
                .andExpect(jsonPath("$.data.morphState.eyeEdit").isEmpty());
    }

    private static final String REDIRECT = "http://localhost:3000/oauth/kakao";
    private static final FakeAiServer AI = new FakeAiServer();

    private static final String BRIDGE_AND_TIP =
            "[{\"code\":\"nose.bridge_height\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\",\"source\":\"콧대는 높이고\"},"
                    + "{\"code\":\"nose.tip_projection\",\"side\":\"both\",\"direction\":1,"
                    + "\"strength\":\"small\",\"source\":\"코끝을 앞으로\"}]";

    @DynamicPropertySource
    static void aiProperties(DynamicPropertyRegistry registry) {
        registry.add("preface.ai.base-url", AI::baseUrl);
        registry.add("preface.ai.read-timeout", () -> "1s");
        registry.add("GMS_KEY", () -> "integration-test-only-gms-key");
    }

    @AfterAll
    static void stopAi() {
        AI.close();
    }

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbcTemplate;

    @MockitoBean KakaoOAuthClient kakao;
    @MockitoBean GoogleOAuthClient google;
    @MockitoBean NoseEditService noseEditService;
    @MockitoBean WeightShapeModelApprovalService weightShapeApproval;
    @MockitoBean WeightContourValidatorClient weightContourValidator;
    @MockitoSpyBean WeightContourEditService weightContourEditService;
    @MockitoBean ReconstructionStorage reconstructionStorage;
    @MockitoBean EyeEditValidatorClient eyeEditValidator;

    private String providerUserId;

    @BeforeEach
    void setUp() {
        when(noseEditService.capabilities(any(Simulation.class), anyMap()))
                .thenAnswer(
                        inv -> {
                            Simulation simulation = inv.getArgument(0);
                            Boolean ready =
                                    jdbcTemplate.queryForObject(
                                            "select chat_apply_ready from face_model where id = ?",
                                            Boolean.class,
                                            simulation.getFaceModelId());
                            if (!Boolean.TRUE.equals(ready)) return null;
                            Map<String, MorphRange> catalog = inv.getArgument(1);
                            return new NoseCapabilities(
                                    "topology",
                                    "rig",
                                    "engine",
                                    catalog.values().stream()
                                            .filter(range -> range.code().startsWith("nose."))
                                            .collect(
                                                    Collectors.toUnmodifiableMap(
                                                            MorphRange::code,
                                                            range ->
                                                                    new NoseCapabilities.Range(
                                                                            range.min(),
                                                                            range.max()))));
                        });
        when(weightShapeApproval.supportedContourCodes(any()))
                .thenReturn(java.util.Set.of("contour.cheekbone"));
        doNothing().when(weightContourEditService).requireSafeFace(any(), anyMap(), any());
        when(reconstructionStorage.presignGet(anyString()))
                .thenReturn(
                        new ReconstructionStorage.PresignedUrl(
                                "https://synthetic.invalid/model",
                                Map.of(),
                                Instant.now().plusSeconds(600)));
        when(eyeEditValidator.validate(anyString(), anyString(), any(), any(), any()))
                .thenReturn(true);
        when(noseEditService.validate(
                        any(Simulation.class),
                        anyMap(),
                        any(MorphEdits.Applied.class),
                        anyMap(),
                        any(),
                        anyBoolean()))
                .thenAnswer(
                        inv -> {
                            Simulation simulation = inv.getArgument(0);
                            MorphEdits.Applied applied = inv.getArgument(2);
                            Boolean ready =
                                    jdbcTemplate.queryForObject(
                                            "select chat_apply_ready from face_model where id = ?",
                                            Boolean.class,
                                            simulation.getFaceModelId());
                            if (!Boolean.TRUE.equals(ready)
                                    && applied.changes().stream()
                                            .anyMatch(
                                                    change -> change.code().startsWith("nose."))) {
                                throw new BusinessException(EditErrorCode.NOSE_EDIT_NOT_READY);
                            }
                            return applied;
                        });
        AI.reset();
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
    void 메시지를_보내면_마스킹본과_후보가_순서대로_저장되고_반영하면_실제값이_이력에_남는다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        Instant before =
                jdbcTemplate
                        .queryForObject(
                                "select updated_at from simulation where id = ?",
                                Timestamp.class,
                                simId)
                        .toInstant();
        Thread.sleep(1100); // DATETIME이 초 단위라 갱신을 구분하려고 기다린다

        AI.respond(200, FakeAiServer.edit("콧대는 높이고 코끝을 앞으로", BRIDGE_AND_TIP, "[]"));
        MvcResult sent =
                send(me, simId, "{\"content\":\"콧대는 높이고 코끝을 앞으로\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.userMessage.content").value("콧대는 높이고 코끝을 앞으로"))
                        .andExpect(jsonPath("$.data.assistantMessage.sender").value("AI 실장님"))
                        .andExpect(jsonPath("$.data.assistantMessage.intent").value("EDIT"))
                        .andExpect(jsonPath("$.data.changeRequest.status").value("COMPLETE"))
                        .andExpect(jsonPath("$.data.changeRequest.schemaVersion").value("v2"))
                        .andExpect(jsonPath("$.data.changeRequest.actions.length()").value(2))
                        .andExpect(jsonPath("$.data.needsClarification").value(false))
                        .andReturn();
        String requestId = JsonPath.read(body(sent), "$.data.changeRequest.requestId");

        // GMS에 보낸 문맥: 문장·현재 가중치·허용 코드만. 이미지·URL 없음
        String aiBody = AI.lastBody();
        assertThat(aiBody)
                .contains("nose.bridge_height")
                .contains("measurements")
                .doesNotContain("mesh")
                .doesNotContain("http");
        assertThat(AI.secrets().getLast()).isEqualTo("Bearer integration-test-only-gms-key");

        assertThat(
                        jdbcTemplate.queryForList(
                                "select concat(seq, ':', role) from consult_message"
                                        + " where simulation_id = ? order by seq",
                                String.class,
                                simId))
                .containsExactly("1:USER", "2:ASSISTANT");
        Map<String, Object> sim =
                jdbcTemplate.queryForMap(
                        "select has_changes, state_version from simulation where id = ?", simId);
        assertThat(sim.get("has_changes")).isEqualTo(true);
        assertThat(sim.get("state_version")).as("대화는 얼굴을 바꾸지 않는다").isEqualTo(0);
        assertThat(
                        jdbcTemplate
                                .queryForObject(
                                        "select updated_at from simulation where id = ?",
                                        Timestamp.class,
                                        simId)
                                .toInstant())
                .as("대화만으로도 시안 수정 시각이 오른다")
                .isAfter(before);

        // EDIT-05: 서버가 계산한 실제값으로 한 거래 저장
        apply(me, simId, requestId, 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.1))
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_projection']").value(0.1))
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.seq").value(1))
                .andExpect(jsonPath("$.data.currentSeq").value(1))
                .andExpect(jsonPath("$.data.applied.length()").value(2))
                .andExpect(jsonPath("$.data.applied[0].from").value(0.0))
                .andExpect(jsonPath("$.data.applied[0].limited").value(false))
                .andExpect(jsonPath("$.data.canUndo").value(true))
                .andExpect(jsonPath("$.data.canRedo").value(false));
        assertThat(
                        jdbcTemplate.queryForMap(
                                "select source, change_request_id from morph_change"
                                        + " where simulation_id = ? and seq = 1",
                                simId))
                .containsEntry("source", "CHAT")
                .containsEntry("change_request_id", requestId);

        // 같은 요청 다시 반영 → CON_010, 이력 그대로
        apply(me, simId, requestId, 1)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CON_010"));

        // CON-02: 순서대로, 반영 결과 복원
        mockMvc.perform(get("/api/v1/simulations/" + simId + "/messages").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalElements").value(2))
                .andExpect(jsonPath("$.data.items[0].role").value("USER"))
                .andExpect(jsonPath("$.data.items[0].sender").doesNotExist())
                .andExpect(jsonPath("$.data.items[1].role").value("ASSISTANT"))
                .andExpect(jsonPath("$.data.items[1].changeRequest.status").value("APPLIED"))
                .andExpect(jsonPath("$.data.items[1].applyResult.seq").value(1))
                .andExpect(jsonPath("$.data.items[1].applyResult.applied.length()").value(2));

        // "더" → 직전 거래 효과를 한 단계 더(AI 호출 없음)
        int aiCalls = AI.bodies().size();
        MvcResult more =
                send(me, simId, "{\"content\":\"조금 더\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.assistantMessage.intent").value("EDIT"))
                        .andReturn();
        assertThat(AI.bodies()).hasSize(aiCalls);
        apply(me, simId, JsonPath.read(body(more), "$.data.changeRequest.requestId"), 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_projection']").value(0.2));

        // 자연어 되돌리기 → EDIT-06과 같은 결과, 대화에 기록
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("UNDO"))
                .andExpect(jsonPath("$.data.morphResult.stateVersion").value(3))
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(1))
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['nose.tip_projection']")
                                .value(0.1))
                .andExpect(jsonPath("$.data.morphResult.undoneSummary").exists());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select max(seq) from consult_message where simulation_id = ?",
                                Integer.class,
                                simId))
                .isEqualTo(6);
    }

    @Test
    void 수술_추천_질문은_의료_안내만_저장하고_편집이나_GMS_호출을_하지_않는다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        int aiCalls = AI.bodies().size();

        send(me, simId, "{\"content\":\"어떤 수술을 하면 코가 예뻐질까요?\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(
                        jsonPath("$.data.assistantMessage.content")
                                .value(org.hamcrest.Matchers.containsString("의료 전문가")))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        assertThat(AI.bodies()).hasSize(aiCalls);
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(0));
    }

    @Test
    void 인물_참조는_원문_대신_비식별_표시만_저장하고_AI를_부르지_않는다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        int aiCalls = AI.bodies().size();

        send(me, simId, "{\"content\":\"가 나나처럼 코끝을 높여줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userMessage.content").value("[인물·사진 참조 요청]"))
                .andExpect(jsonPath("$.data.userMessage.masked").value(true))
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(jsonPath("$.data.assistantMessage.filtered").value(true))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        assertThat(AI.bodies()).hasSize(aiCalls);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select content from consult_message where simulation_id = ? and role = 'USER'",
                                String.class,
                                simId))
                .isEqualTo("[인물·사진 참조 요청]");
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select state_version from simulation where id = ?",
                                Integer.class,
                                simId))
                .isZero();
    }

    @Test
    void 버전이_다르면_EDIT_002이고_얼굴과_이력이_그대로다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        String requestId = sendEdit(me, simId);

        apply(me, simId, requestId, 5)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_002"));
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                simId))
                .isEqualTo(1);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select status from change_request where id = ?",
                                String.class,
                                requestId))
                .isEqualTo("COMPLETE");
    }

    @Test
    void 상담_후_코_승인이_잠기면_이전_후보와_슬라이더로_얼굴을_바꾸지_못한다() throws Exception {
        Member me = newMember();
        String modelId = insertFaceModel(me.userId());
        String simId = createdSimulationId(me, modelId);
        String requestId = sendEdit(me, simId);
        jdbcTemplate.update("update face_model set chat_apply_ready = false where id = ?", modelId);

        apply(me, simId, requestId, 0)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_030"))
                .andExpect(jsonPath("$.data.morphState").doesNotExist());
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select state_version from simulation where id = ?",
                                Integer.class,
                                simId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from morph_change where simulation_id = ?",
                                Integer.class,
                                simId))
                .isEqualTo(1);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select status from change_request where id = ?",
                                String.class,
                                requestId))
                .isEqualTo("COMPLETE");
        // 상담 후보는 대화 기록에 그대로 남는다
        mockMvc.perform(get("/api/v1/simulations/" + simId + "/messages").headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[1].changeRequest.status").value("COMPLETE"))
                .andExpect(jsonPath("$.data.items[1].applyResult").isEmpty());

        // 승인 정보가 없는 모델은 슬라이더도 얼굴과 이력을 바꾸지 않는다.
        mockMvc.perform(
                        patch("/api/v1/simulations/" + simId + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":0,\"changes\":[{\"code\":"
                                                + "\"nose.bridge_height\",\"value\":0.2}]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_031"));
    }

    @Test
    void 남의_시안에는_메시지_조회_반영_모두_COMMON_002다() throws Exception {
        Member owner = newMember();
        Member other = newMember();
        String simId = createdSimulationId(owner, insertFaceModel(owner.userId()));
        String requestId = sendEdit(owner, simId);
        int aiCalls = AI.bodies().size();

        send(other, simId, "{\"content\":\"콧대를 조금 높여줘\"}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        mockMvc.perform(get("/api/v1/simulations/" + simId + "/messages").headers(auth(other)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        apply(other, simId, requestId, 0)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
        assertThat(AI.bodies()).as("남의 시안이면 AI를 부르지 않는다").hasSize(aiCalls);
    }

    @Test
    void GMS가_늦거나_실패하면_CON_002_CON_003이고_아무것도_저장하지_않는다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));

        AI.respond(200, FakeAiServer.reply("코 모양을 다듬어줘", false, "코 편집을 도와드려요."));
        AI.delay(2000);
        send(me, simId, "{\"content\":\"코 모양을 다듬어줘\"}")
                .andExpect(status().isGatewayTimeout())
                .andExpect(jsonPath("$.error.code").value("CON_002"));

        AI.respond(500, "{\"detail\":\"error\"}");
        send(me, simId, "{\"content\":\"코 모양을 다듬어줘\"}")
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error.code").value("CON_003"));

        AI.respond(504, "{\"detail\":\"timeout\"}");
        send(me, simId, "{\"content\":\"코 모양을 다듬어줘\"}")
                .andExpect(status().isGatewayTimeout())
                .andExpect(jsonPath("$.error.code").value("CON_002"));

        send(me, simId, "{\"content\":\"" + "가".repeat(301) + "\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("CON_001"));

        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from consult_message where simulation_id = ?",
                                Integer.class,
                                simId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select has_changes from simulation where id = ?",
                                Boolean.class,
                                simId))
                .isFalse();
    }

    @Test
    void GMS가_미지원_효과나_잘못된_좌우를_내면_상담과_편집을_저장하지_않는다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        String text = "콧대 높이를 완만하게 해줘";
        for (String action :
                List.of(
                        "{\"code\":\"nose.bridge_hump\",\"side\":\"both\",\"direction\":-1,\"strength\":\"small\",\"source\":\"콧대 높이\"}",
                        "{\"code\":\"nose.bridge_height\",\"side\":\"left\",\"direction\":-1,\"strength\":\"small\",\"source\":\"콧대 높이\"}")) {
            AI.respond(200, FakeAiServer.edit(text, "[" + action + "]", "[]"));
            send(me, simId, "{\"content\":\"" + text + "\"}")
                    .andExpect(status().isBadGateway())
                    .andExpect(jsonPath("$.error.code").value("CON_003"));
        }
        assertThat(AI.bodies()).hasSize(2);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from consult_message where simulation_id = ?",
                                Integer.class,
                                simId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from change_request where simulation_id = ?",
                                Integer.class,
                                simId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select state_version from simulation where id = ?",
                                Integer.class,
                                simId))
                .isZero();
    }

    @ParameterizedTest(name = "합성 보류셋 안전 경계 {index}")
    @CsvFileSource(resources = "/consult-safety-holdout-v1.csv", numLinesToSkip = 1)
    void 합성_보류셋의_무편집_요청은_AI_호출_없이_끝난다(String content, String intent) throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        AI.respond(500, "{}");

        send(me, simId, "{\"content\":\"" + content + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value(intent))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        assertThat(AI.bodies()).isEmpty();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from change_request where simulation_id = ?",
                                Integer.class,
                                simId))
                .isZero();
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select state_version from simulation where id = ?",
                                Integer.class,
                                simId))
                .isZero();
    }

    @Test
    void 같은_상담_요청_ID를_다시_보내도_GMS와_대화를_중복_저장하지_않는다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        AI.respond(200, FakeAiServer.reply("코 모양을 다듬어줘", false, "코 편집을 도와드릴게요."));
        String body =
                "{\"content\":\"코 모양을 다듬어줘\",\"requestId\":\"73e820aa-2afa-4dd1-aa16-d926c5cd69f4\"}";

        send(me, simId, body).andExpect(status().isOk());
        send(me, simId, body)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CON_011"));
        assertThat(AI.bodies()).hasSize(1);
        assertThat(
                        jdbcTemplate.queryForObject(
                                "select count(*) from consult_message where simulation_id = ?",
                                Integer.class,
                                simId))
                .isEqualTo(2);
    }

    @Test
    void 되묻기_선택은_안내만_하고_명확한_요청만_한_번_적용한다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));

        MvcResult asked =
                send(me, simId, "{\"content\":\"코끝이 좀 답답해 보여\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.needsClarification").value(true))
                        .andExpect(jsonPath("$.data.changeRequest").isEmpty())
                        .andExpect(jsonPath("$.data.options.length()").value(2))
                        .andExpect(jsonPath("$.data.options[0].actions").doesNotExist())
                        .andReturn();
        String optionId = JsonPath.read(body(asked), "$.data.options[1].id");

        send(me, simId, "{\"content\":\"코끝 위아래\",\"selectedOptionId\":\"" + optionId + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userMessage.content").value("코끝 위아래"))
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(
                        jsonPath("$.data.assistantMessage.content")
                                .value(org.hamcrest.Matchers.containsString("코끝을 조금 올려줘")))
                .andExpect(jsonPath("$.data.options").isEmpty())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(0))
                .andExpect(jsonPath("$.data.canUndo").value(false))
                .andExpect(jsonPath("$.data.morphState.weights").isEmpty());
        MvcResult explicit =
                send(me, simId, "{\"content\":\"그럼 조금 올려줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.userMessage.content").value("그럼 조금 올려줘"))
                        .andExpect(jsonPath("$.data.changeRequest.actions.length()").value(1))
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("nose.tip_height"))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(explicit), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_height']").value(0.06))
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_rotation']").value(0.04));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_height']").value(0.06));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("UNDO"))
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(0));

        // 다시 묻고, 슬라이더로 시안을 바꾼 뒤 옛 선택지를 누르면 적용하지 않는다
        MvcResult askedAgain = send(me, simId, "{\"content\":\"코끝을 바꿔줘\"}").andReturn();
        String staleOption = JsonPath.read(body(askedAgain), "$.data.options[1].id");
        mockMvc.perform(
                        patch("/api/v1/simulations/" + simId + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":2,\"changes\":[{\"code\":"
                                                + "\"nose.tip_height\",\"value\":0.2}]}"))
                .andExpect(status().isOk());
        send(me, simId, "{\"content\":\"코끝 돌출 조절\",\"selectedOptionId\":\"" + staleOption + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("CLARIFY"))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
    }

    @Test
    void 한_부위의_방향을_되묻고_답을_받으면_저장_재조회_한_번_되돌리기가_된다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));

        send(me, simId, "{\"content\":\"콧대만 바꿔줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.needsClarification").value(true))
                .andExpect(jsonPath("$.data.options.length()").value(1))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        MvcResult direction =
                send(me, simId, "{\"content\":\"그럼 조금 올려줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.changeRequest.actions.length()").value(1))
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("nose.bridge_height"))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(direction), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.1));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.1));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(0));
    }

    @ParameterizedTest
    @ValueSource(strings = {"조금만", "좋아요", "조금 더"})
    void 안내_직후라도_방향이_없으면_편집하지_않는다(String ambiguous) throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        selectTipGuidance(me, simId);

        send(me, simId, "{\"content\":\"" + ambiguous + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        send(me, simId, "{\"content\":\"그럼 조금 올려줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(0))
                .andExpect(jsonPath("$.data.canUndo").value(false));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void 안내_후_시안이_바뀌면_후속_요청이나_생성한_후보를_적용하지_않는다(boolean hasCandidate) throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        selectTipGuidance(me, simId);
        String direction = "{\"content\":\"그럼 조금 올려줘\"}";
        String requestId = null;
        if (hasCandidate) {
            var response = send(me, simId, direction).andExpect(status().isOk()).andReturn();
            requestId = JsonPath.read(body(response), "$.data.changeRequest.requestId");
        }
        mockMvc.perform(
                        patch("/api/v1/simulations/" + simId + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":0,\"changes\":[{\"code\":"
                                                + "\"nose.bridge_height\",\"value\":0.2}]}"))
                .andExpect(status().isOk());
        if (hasCandidate) {
            apply(me, simId, requestId, 1)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error.code").value("EDIT_002"));
        } else {
            send(me, simId, direction)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        }
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.2))
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_height']").doesNotExist());
    }

    private void selectTipGuidance(Member me, String simId) throws Exception {
        var asked =
                send(me, simId, "{\"content\":\"코끝이 좀 답답해 보여\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        String optionId = JsonPath.read(body(asked), "$.data.options[1].id");
        send(me, simId, "{\"content\":\"코끝 위아래\",\"selectedOptionId\":\"" + optionId + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"오른쪽만 해줘", "위트임이랑 코끝 높이를 같이 조정해줘"})
    void 한쪽_정정이나_되묻기_뒤의_더_덜은_이전_양쪽_눈을_조절하지_않는다(String correction) throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        String simId = createdSimulationId(me, model);
        MvcResult eye =
                send(me, simId, "{\"content\":\"양쪽 앞트임을 살짝 넓혀줘\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(eye), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(2.0))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.R.values.inner").value(2.0));

        send(me, simId, "{\"content\":\"" + correction + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        for (String command : List.of("조금 더", "조금 덜")) {
            send(me, simId, "{\"content\":\"" + command + "\"}")
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        }
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.currentSeq").value(1))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(2.0))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.R.values.inner").value(2.0));
    }

    @Test
    void 콧볼_후속_축소는_직전_콧볼만_조절하고_다른_부위_뒤에는_적용하지_않는다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        AI.respond(
                200,
                FakeAiServer.edit(
                        "콧볼을 좁혀줘",
                        "[{\"code\":\"nose.alar_width\",\"side\":\"both\",\"direction\":-1,\"strength\":\"small\"}]",
                        "[]"));
        MvcResult first =
                send(me, simId, "{\"content\":\"콧볼을 좁혀줘\"}").andExpect(status().isOk()).andReturn();
        apply(me, simId, JsonPath.read(body(first), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.alar_width']").value(-0.1));

        int aiCalls = AI.bodies().size();
        MvcResult followUp =
                send(me, simId, "{\"content\":\"조금 더 좁혀줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.assistantMessage.intent").value("EDIT"))
                        .andReturn();
        assertThat(AI.bodies()).hasSize(aiCalls);
        apply(me, simId, JsonPath.read(body(followUp), "$.data.changeRequest.requestId"), 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.alar_width']").value(-0.2));

        mockMvc.perform(
                        patch("/api/v1/simulations/" + simId + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":2,\"changes\":[{\"code\":"
                                                + "\"nose.bridge_height\",\"value\":0.1}]}"))
                .andExpect(status().isOk());
        send(me, simId, "{\"content\":\"조금 더 좁혀줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());

        String otherSimId = createdSimulationId(me, insertFaceModel(me.userId()));
        apply(me, otherSimId, sendEdit(me, otherSimId), 0).andExpect(status().isOk());
        send(me, otherSimId, "{\"content\":\"조금 더 좁혀줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
    }

    @Test
    void 코끝_정정은_콧대를_보존하고_재조회와_한번의_되돌리기를_지원한다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        var range = new NoseCapabilities.Range(-1, 1);
        doReturn(
                        new NoseCapabilities(
                                "topology",
                                "rig",
                                "engine",
                                Map.of("nose.tip_projection", range, "nose.bridge_height", range)))
                .when(noseEditService)
                .capabilities(any(Simulation.class), anyMap());
        AI.respond(
                200,
                FakeAiServer.edit(
                        "코끝을 앞으로 조금",
                        "[{\"code\":\"nose.tip_projection\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\"}]",
                        "[]"));
        MvcResult first =
                send(me, simId, "{\"content\":\"코끝을 앞으로 조금\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(first), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk());
        String simulationPath = "/api/v1/simulations/" + simId;
        mockMvc.perform(
                        patch(simulationPath + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":1,\"changes\":[{\"code\":\"nose.bridge_height\",\"value\":0.2}]}"))
                .andExpect(status().isOk());

        int aiCalls = AI.bodies().size();
        MvcResult ambiguous =
                send(me, simId, "{\"content\":\"아까 거 조금만 줄여줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.needsClarification").value(true))
                        .andExpect(jsonPath("$.data.changeRequest").doesNotExist())
                        .andReturn();
        String oldChoice = JsonPath.read(body(ambiguous), "$.data.options[0].id");
        MvcResult correction =
                send(me, simId, "{\"content\":\"콧대는 그대로 두고 아까 바꾼 코끝만 되돌려줘\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(correction), "$.data.changeRequest.requestId"), 2)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.applied.length()").value(1))
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.tip_projection']").doesNotExist())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.2));
        mockMvc.perform(get(simulationPath).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(3))
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.tip_projection']").doesNotExist())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.2));
        send(me, simId, "{\"content\":\"코끝 선택\",\"selectedOptionId\":\"" + oldChoice + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").doesNotExist());
        send(me, simId, "{\"content\":\"되돌려줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.stateVersion").value(4))
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['nose.tip_projection']")
                                .value(0.1))
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['nose.bridge_height']")
                                .value(0.2));

        MvcResult clarify =
                send(me, simId, "{\"content\":\"아까 거 조금만 줄여줘\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        String choice = JsonPath.read(body(clarify), "$.data.options[0].id");
        MvcResult chosen =
                send(me, simId, "{\"content\":\"코끝 선택\",\"selectedOptionId\":\"" + choice + "\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        mockMvc.perform(
                        patch(simulationPath + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":4,\"changes\":[{\"code\":\"nose.bridge_height\",\"value\":0.3}]}"))
                .andExpect(status().isOk());
        apply(me, simId, JsonPath.read(body(chosen), "$.data.changeRequest.requestId"), 5)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_002"));
        mockMvc.perform(get(simulationPath).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(5))
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_projection']").value(0.1))
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.3));
        assertThat(AI.bodies()).hasSize(aiCalls);
    }

    @Test
    void 방금_한_편집을_약하게_하면_그_코끝만_되돌리고_슬라이더_뒤에는_적용하지_않는다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        AI.respond(
                200,
                FakeAiServer.edit(
                        "코끝을 앞으로 조금",
                        "[{\"code\":\"nose.tip_projection\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\"}]",
                        "[]"));
        MvcResult first =
                send(me, simId, "{\"content\":\"코끝을 앞으로 조금\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(first), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_projection']").value(0.1));

        int aiCalls = AI.bodies().size();
        MvcResult weaker =
                send(me, simId, "{\"content\":\"방금 한 걸 조금 약하게 해줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.assistantMessage.intent").value("EDIT"))
                        .andReturn();
        assertThat(AI.bodies()).hasSize(aiCalls);
        apply(me, simId, JsonPath.read(body(weaker), "$.data.changeRequest.requestId"), 1)
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.tip_projection']")
                                .doesNotExist());

        mockMvc.perform(
                        patch("/api/v1/simulations/" + simId + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":2,\"changes\":[{\"code\":"
                                                + "\"nose.bridge_height\",\"value\":0.1}]}"))
                .andExpect(status().isOk());
        send(me, simId, "{\"content\":\"방금 한 걸 조금 약하게 해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        assertThat(AI.bodies()).hasSize(aiCalls);
    }

    @Test
    void 더_덜은_슬라이더_편집_뒤_오래된_채팅을_적용하지_않고_되돌리면_다시_적용한다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        apply(me, simId, sendEdit(me, simId), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.1));

        mockMvc.perform(
                        patch("/api/v1/simulations/" + simId + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":1,\"changes\":[{\"code\":"
                                                + "\"nose.tip_projection\",\"value\":0.1}]}"))
                .andExpect(status().isOk());

        int aiCalls = AI.bodies().size();
        send(me, simId, "{\"content\":\"더 많이\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        send(me, simId, "{\"content\":\"조금 덜\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        assertThat(AI.bodies()).hasSize(aiCalls);
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(jsonPath("$.data.stateVersion").value(2))
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.1))
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_projection']").value(0.1));

        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(1));
        MvcResult more =
                send(me, simId, "{\"content\":\"더 많이\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.assistantMessage.intent").value("EDIT"))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(more), "$.data.changeRequest.requestId"), 3)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.2));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(1));
        send(me, simId, "{\"content\":\"더 많이\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("EDIT"));
    }

    @Test
    void 금지_지시는_기존_코_값과_이력을_보존하고_명확한_대조는_요청한_부위만_저장한다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        mockMvc.perform(
                        patch("/api/v1/simulations/" + simId + "/morph-state")
                                .headers(auth(me))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"stateVersion\":0,\"changes\":[{\"code\":\"nose.bridge_height\",\"value\":0.4}]}"))
                .andExpect(status().isOk());

        send(me, simId, "{\"content\":\"콧대를 더 높이지 말아줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.assistantMessage.intent").value("REPLY"))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(1))
                .andExpect(jsonPath("$.data.currentSeq").value(1))
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.4));

        MvcResult sent =
                send(me, simId, "{\"content\":\"콧대는 그대로 두고 코끝만 앞으로 내밀어줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.changeRequest.actions.length()").value(1))
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("nose.tip_projection"))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(sent), "$.data.changeRequest.requestId"), 1)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.currentSeq").value(2))
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.4))
                .andExpect(jsonPath("$.data.morphState.weights['nose.tip_projection']").value(0.1));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['nose.bridge_height']")
                                .value(0.4))
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['nose.tip_projection']")
                                .doesNotExist());
        assertThat(AI.bodies()).isEmpty();
    }

    @Test
    void 부정_대조로_콧대를_낮추면_재조회와_되돌리기에_같은_값이_보인다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        int aiCalls = AI.bodies().size();

        MvcResult sent =
                send(me, simId, "{\"content\":\"콧대를 높이지 말고 낮춰줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("nose.bridge_height"))
                        .andExpect(jsonPath("$.data.changeRequest.actions[0].direction").value(-1))
                        .andReturn();
        assertThat(AI.bodies()).hasSize(aiCalls);

        apply(me, simId, JsonPath.read(body(sent), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(-0.1));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(-0.1));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['nose.bridge_height']")
                                .doesNotExist());
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.bridge_height']").doesNotExist());
    }

    @Test
    void 부정_대조로_코끝을_뒤로_옮기면_재조회와_되돌리기에_같은_값이_보인다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        int aiCalls = AI.bodies().size();

        MvcResult sent =
                send(me, simId, "{\"content\":\"코끝을 내밀지 말고 넣어줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("nose.tip_projection"))
                        .andExpect(jsonPath("$.data.changeRequest.actions[0].direction").value(-1))
                        .andReturn();
        assertThat(AI.bodies()).hasSize(aiCalls);

        apply(me, simId, JsonPath.read(body(sent), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.tip_projection']").value(-0.1));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphState.weights['nose.tip_projection']").value(-0.1));
        send(me, simId, "{\"content\":\"방금 거 취소해줘\"}")
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.morphResult.morphState.weights['nose.tip_projection']")
                                .doesNotExist());
    }

    // ---- 도우미 ----

    private record Member(String userId, String accessToken) {}

    private String sendEdit(Member member, String simId) throws Exception {
        AI.respond(
                200,
                FakeAiServer.edit(
                        "콧대를 조금 높여줘",
                        "[{\"code\":\"nose.bridge_height\",\"side\":\"both\",\"direction\":1,"
                                + "\"strength\":\"small\"}]",
                        "[]"));
        MvcResult sent =
                send(member, simId, "{\"content\":\"콧대를 조금 높여줘\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        return JsonPath.read(body(sent), "$.data.changeRequest.requestId");
    }

    private ResultActions send(Member member, String simId, String json) throws Exception {
        return mockMvc.perform(
                post("/api/v1/simulations/" + simId + "/messages")
                        .headers(auth(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json));
    }

    private ResultActions apply(Member member, String simId, String requestId, int stateVersion)
            throws Exception {
        return mockMvc.perform(
                post("/api/v1/simulations/" + simId + "/change-requests/" + requestId + "/apply")
                        .headers(auth(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"stateVersion\":" + stateVersion + "}"));
    }

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

    /** 채팅 적용이 열린 합성 v2 3D. */
    private String insertFaceModel(String userId) {
        return insertFaceModel(userId, true);
    }

    /** 합성 v2 3D 한 개(업로드·복원 작업·모델 행). 실제 파일은 없다. */
    private String insertFaceModel(String userId, boolean chatApplyReady) {
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
                        + " values (?, ?, ?, 'SUCCEEDED')",
                jobId,
                userId,
                uploadId);
        jdbcTemplate.update(
                "insert into face_model(id, user_id, reconstruction_job_id, mesh_object_key,"
                        + " morph_schema_version, chat_apply_ready) values (?, ?, ?, ?, 'v2', ?)",
                faceModelId,
                userId,
                jobId,
                "users/" + userId + "/models/" + jobId + "/mesh.glb",
                chatApplyReady);
        return faceModelId;
    }

    private void approveEyes(String model, String review) {
        String mesh = "a".repeat(64);
        String rig = "b".repeat(64);
        String parts = "c".repeat(64);
        jdbcTemplate.update(
                "update face_model set eye_review = ?, eye_parts_sha256 = ?, rig_object_key = ?,"
                        + " approved_nose_capabilities = ?, approved_eye_capabilities = ? where id = ?",
                review,
                parts,
                "synthetic/rig.json",
                "{\"schemaVersion\":\"v2\",\"binding\":{\"meshSha256\":\""
                        + mesh
                        + "\",\"rigSha256\":\""
                        + rig
                        + "\",\"fitSha\":\"fit\",\"engine\":\"v1\",\"rigVersion\":\"v1\",\"topologyVersion\":\"v1\"},\"ranges\":{}}",
                "{\"schemaVersion\":\"v2\",\"meshSha256\":\""
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
                "{\"schemaVersion\":\"v2\",\"binding\":{\"meshSha256\":\""
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
                mockMvc.perform(
                                post("/api/v1/face-models/" + faceModelId + "/simulations")
                                        .headers(auth(member))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{}"))
                        .andExpect(status().isCreated())
                        .andReturn();
        return JsonPath.read(body(result), "$.data.simulationId");
    }

    private static HttpHeaders auth(Member member) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(member.accessToken());
        return headers;
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    @Test
    void 첨부_복합_윤곽과_강도를_한_이력으로_저장하고_한번에_되돌린다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId(), false);
        String simId = createdSimulationId(me, model);
        when(weightShapeApproval.supportedContourCodes(any()))
                .thenReturn(java.util.Set.of("contour.cheekbone", "contour.jaw_angle"));
        doNothing().when(weightContourEditService).requireSafeContour(any(), anyMap());
        send(me, simId, "{\"content\":\"그럼 한 단계만 더 줄여줘\"}")
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.assistantMessage.content")
                                .value(org.hamcrest.Matchers.startsWith("어느 부위를 더 조절할까요?")))
                .andExpect(jsonPath("$.data.changeRequest").doesNotExist())
                .andExpect(jsonPath("$.data.morphResult").doesNotExist());
        MvcResult proposed =
                send(me, simId, "{\"content\":\"광대는 조금, 사각턱은 많이 줄여줘\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(proposed), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['contour.cheekbone']").value(-0.1))
                .andExpect(jsonPath("$.data.morphState.weights['contour.jaw_angle']").value(-0.3));
        send(me, simId, "{\"content\":\"되돌려줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(0));
        MvcResult jaw =
                send(me, simId, "{\"content\":\"사각턱 줄여줘\"}").andExpect(status().isOk()).andReturn();
        apply(me, simId, JsonPath.read(body(jaw), "$.data.changeRequest.requestId"), 2)
                .andExpect(status().isOk());
        MvcResult reduce =
                send(me, simId, "{\"content\":\"그럼 한 단계만 더 줄여줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(
                                jsonPath("$.data.changeRequest.actions[0].code")
                                        .value("contour.jaw_angle"))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(reduce), "$.data.changeRequest.requestId"), 3)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['contour.jaw_angle']").value(-0.2));
    }

    @Test
    void 코와_윤곽을_합친_형상이_통과하면_같은_이력으로_저장한다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId()));
        when(weightShapeApproval.supportedContourCodes(any()))
                .thenReturn(java.util.Set.of("contour.jaw_angle"));
        MvcResult proposed =
                send(me, simId, "{\"content\":\"콧대는 조금 올리고 사각턱은 많이 줄여줘\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(proposed), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphState.weights['nose.bridge_height']").value(0.1))
                .andExpect(jsonPath("$.data.morphState.weights['contour.jaw_angle']").value(-0.3));
        verify(weightContourEditService)
                .requireSafeFace(
                        any(),
                        eq(Map.of("nose.bridge_height", 0.1, "contour.jaw_angle", -0.3)),
                        isNull());
        send(me, simId, "{\"content\":\"되돌려줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(0));
        doThrow(new BusinessException(EditErrorCode.UNSAFE_CONTOUR_EDIT))
                .when(weightContourEditService)
                .requireSafeFace(any(), anyMap(), any());
        MvcResult rejected =
                send(me, simId, "{\"content\":\"콧대는 조금 올리고 사각턱은 많이 줄여줘\"}")
                        .andExpect(status().isOk())
                        .andReturn();
        apply(me, simId, JsonPath.read(body(rejected), "$.data.changeRequest.requestId"), 2)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("EDIT_033"));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(2))
                .andExpect(jsonPath("$.data.canUndo").value(false));
    }

    @Test
    void 앞트임과_광대의_슬라이더_표시값을_한_이력으로_저장한다() throws Exception {
        Member me = newMember();
        String model = insertFaceModel(me.userId());
        approveEyes(model, "{\"L\":\"absent\",\"R\":\"absent\"}");
        String simId = createdSimulationId(me, model);
        MvcResult sent =
                send(me, simId, "{\"content\":\"앞트임을 10%로 맞추고 광대 크기는 -10%로 맞춰줘\"}")
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.changeRequest.actions.length()").value(2))
                        .andReturn();
        apply(me, simId, JsonPath.read(body(sent), "$.data.changeRequest.requestId"), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.seq").value(1))
                .andExpect(jsonPath("$.data.morphState.eyeEdit.L.values.inner").value(2.0))
                .andExpect(jsonPath("$.data.morphState.weights['contour.cheekbone']").value(-0.1));
        verify(weightContourEditService)
                .requireSafeFace(any(), eq(Map.of("contour.cheekbone", -0.1)), any());
        send(me, simId, "{\"content\":\"되돌려줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.morphResult.currentSeq").value(0));
    }

    @Test
    void 둘_다는_직전_선택지와_방향이_유효할_때만_편집한다() throws Exception {
        Member me = newMember();
        String simId = createdSimulationId(me, insertFaceModel(me.userId(), false));
        when(weightShapeApproval.supportedContourCodes(any()))
                .thenReturn(java.util.Set.of("contour.jaw_angle", "contour.chin_length"));
        send(me, simId, "{\"content\":\"턱도 줄여줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.needsClarification").value(true))
                .andExpect(jsonPath("$.data.changeRequest").isEmpty());
        send(me, simId, "{\"content\":\"둘 다\"}")
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data.changeRequest.actions[0].code").value("contour.jaw_angle"))
                .andExpect(
                        jsonPath("$.data.changeRequest.actions[1].code")
                                .value("contour.chin_length"));
        send(me, simId, "{\"content\":\"턱을 바꿔줘\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.needsClarification").value(true));
        send(me, simId, "{\"content\":\"둘 다\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.changeRequest").isEmpty())
                .andExpect(
                        jsonPath("$.data.assistantMessage.content")
                                .value("두 항목을 각각 어떻게 바꿀까요? 얼굴은 바꾸지 않았어요."));
        mockMvc.perform(get("/api/v1/simulations/" + simId).headers(auth(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.stateVersion").value(0));
    }
}
