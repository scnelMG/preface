package com.preface.api.consult.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.consult.dto.EditAction;
import com.preface.api.consult.dto.SampleConsultRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ConsultErrorCode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import tools.jackson.databind.json.JsonMapper;

class SampleConsultServiceTest {
    private static final String SHA =
            "c856a88dd70667f9be3e17c5eaa3d65760eedfd504a7bf4319ec6ca31bbca1c5";
    private final SpringConsultClient ai = mock(SpringConsultClient.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> values = mock(ValueOperations.class);

    private final SampleConsultService service = new SampleConsultService(ai, redis);

    @BeforeEach
    void setUp() {
        when(redis.opsForValue()).thenReturn(values);
        when(values.setIfAbsent(anyString(), eq("1"), eq(Duration.ofSeconds(3)))).thenReturn(true);
    }

    @Test
    void 로그인_기본_모델은_실제_표시_코드만_상담에_보내고_서버에_시안을_만들지_않는다() {
        when(ai.consult(any()))
                .thenAnswer(
                        inv -> {
                            AiConsult.Request aiRequest = inv.getArgument(0);
                            assertThat(aiRequest.simulationId())
                                    .startsWith("sample:user-1:base-male");
                            assertThat(aiRequest.allowedCodes())
                                    .contains(
                                            "nose.bridge_height", "contour.cheekbone", "eye.inner")
                                    .doesNotContain("contour.weight_shape", "eye.height");
                            assertThat(aiRequest.recentMessages()).isEmpty();
                            assertThat(aiRequest.measurements()).isEmpty();
                            return reply(new EditAction("contour.cheekbone", "both", 1, "small"));
                        });
        AiConsult.Response result =
                service.consult(
                        "user-1",
                        "base-male",
                        request(
                                "광대를 키워줘",
                                SHA,
                                List.of("nose.bridge_height", "contour.cheekbone", "unknown")));
        assertThat(result.changeRequest().actions())
                .extracting(EditAction::code)
                .containsExactly("contour.cheekbone");
    }

    @Test
    void 모델_해시가_다르거나_조절값이_범위_밖이면_AI를_부르지_않는다() {
        assertThatThrownBy(
                        () ->
                                service.consult(
                                        "user-1", "base-male", request("광대를 키워줘", "x", List.of())))
                .isInstanceOf(BusinessException.class);
        SampleConsultRequest invalid =
                new SampleConsultRequest(
                        "광대를 키워줘",
                        java.util.UUID.randomUUID().toString(),
                        SHA,
                        Map.of("contour.cheekbone", 2.0),
                        List.of("contour.cheekbone"),
                        false,
                        false,
                        false);
        assertThatThrownBy(() -> service.consult("user-1", "base-male", invalid))
                .isInstanceOf(BusinessException.class);
        verify(ai, never()).consult(any());
    }

    @Test
    void 연속_상담은_호출_간격을_제한하지만_되돌리기는_바로_처리한다() {
        when(values.setIfAbsent(anyString(), eq("1"), eq(Duration.ofSeconds(3)))).thenReturn(false);
        assertThatThrownBy(
                        () ->
                                service.consult(
                                        "user-1", "base-male", request("광대를 키워줘", SHA, List.of())))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e ->
                                assertThat(e.errorCode())
                                        .isEqualTo(CommonErrorCode.TOO_MANY_REQUESTS));
        AiConsult.Response undo =
                service.consult("user-1", "base-male", request("방금 거 취소해줘", SHA, List.of()));
        assertThat(undo.intent()).isEqualTo("UNDO");
        verify(ai, never()).consult(any());
    }

    @Test
    void 모델에_없는_AI_후보는_체험에도_반영하지_않는다() {
        when(ai.consult(any()))
                .thenReturn(reply(new EditAction("nose.alar_width", "both", 1, "small")));
        assertThatThrownBy(
                        () ->
                                service.consult(
                                        "user-1",
                                        "base-male",
                                        request("콧볼을 넓혀줘", SHA, List.of("contour.cheekbone"))))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ConsultErrorCode.NOT_APPLICABLE));
    }

    @Test
    void 서버가_고정한_기본_모델_해시는_웹_자산_manifest와_같다() throws Exception {
        var manifest =
                JsonMapper.builder()
                        .build()
                        .readTree(
                                Files.readString(
                                        Path.of(
                                                "..",
                                                "..",
                                                "..",
                                                "apps",
                                                "web",
                                                "public",
                                                "models",
                                                "manifest.json")));
        for (var model : manifest.path("models")) {
            var result =
                    service.consult(
                            "user-1",
                            model.path("key").asText(),
                            request("방금 거 취소해줘", model.path("sha256").asText(), List.of()));
            assertThat(result.intent()).isEqualTo("UNDO");
        }
    }

    private static SampleConsultRequest request(String content, String sha, List<String> codes) {
        return new SampleConsultRequest(
                content,
                java.util.UUID.randomUUID().toString(),
                sha,
                Map.of(),
                codes,
                true,
                false,
                false);
    }

    private static AiConsult.Response reply(EditAction action) {
        return new AiConsult.Response(
                "광대를 키워줘",
                false,
                "",
                "EDIT",
                new AiConsult.CandidateRequest("COMPLETE", "v2", List.of(action), List.of()),
                false,
                List.of(),
                false,
                null);
    }
}
