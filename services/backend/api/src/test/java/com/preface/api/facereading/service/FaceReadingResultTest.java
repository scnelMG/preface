package com.preface.api.facereading.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** GMS 결과를 저장하기 전 검사(형식·개수·길이). 내용(단점·단정·시술 언급)은 막지 않는다(-694). */
class FaceReadingResultTest {

    private final ObjectMapper mapper = JsonMapper.builder().build();

    static final String VALID =
            """
            {"title":"복이 쌓이는 둥근 관상",
             "parts":[
              {"part":"FOREHEAD","name":"이마","reading":"넓고 반듯한 이마라 초년에 배움의 복이 따라요."},
              {"part":"EYES","name":"눈","reading":"부드러운 눈매가 사람을 편하게 해요."},
              {"part":"MOUTH","name":"입","reading":"살짝 올라간 입꼬리에 말복이 붙어요."}],
             "overall":"균형이 좋아 꾸준히 복을 쌓는 관상이에요.",
             "advice":[{"part":"EYEBROWS","change":"눈썹을 또렷하게 그리면","effect":"추진력이 더해 보여요"}]}
            """;

    @Test
    void 형식과_개수와_길이가_맞으면_통과한다() {
        assertThatCode(() -> FaceReadingResult.validate(mapper.readTree(VALID)))
                .doesNotThrowAnyException();
    }

    @Test
    void 단점_단정_시술_언급도_내용으로는_막지_않는다() {
        // 실제 관상가처럼 장단점을 말하게 해 금지어 검사를 없앴다(-694)
        for (String said : new String[] {"코 성형을 하면", "반드시 부자가 돼요", "콧방울이 얇아 재물이 새요"}) {
            String json = VALID.replace("눈썹을 또렷하게 그리면", said);
            assertThatCode(() -> FaceReadingResult.validate(mapper.readTree(json)))
                    .doesNotThrowAnyException();
        }
    }

    @Test
    void 풀이가_길면_저장하지_않는다() {
        // 근거와 장단점을 담도록 늘린 상한(-694): 부위 120자, 종합 260자
        assertThatCode(
                        () ->
                                FaceReadingResult.validate(
                                        mapper.readTree(
                                                VALID.replace(
                                                        "부드러운 눈매가 사람을 편하게 해요.", "가".repeat(120)))))
                .doesNotThrowAnyException();
        assertRejected(VALID.replace("부드러운 눈매가 사람을 편하게 해요.", "가".repeat(121)));
        assertRejected(VALID.replace("균형이 좋아 꾸준히 복을 쌓는 관상이에요.", "가".repeat(261)));
        String five =
                VALID.replace(
                        "{\"part\":\"MOUTH\"",
                        "{\"part\":\"NOSE\",\"name\":\"코\",\"reading\":\"곧은 콧대에 재물이 모여요.\"},"
                                + "{\"part\":\"CHIN\",\"name\":\"턱\",\"reading\":\"둥근 턱선이라 말년이 편해요.\"},"
                                + "{\"part\":\"MOUTH\"");
        assertRejected(five);
    }

    @Test
    void 부위가_너무_적거나_조언이_없으면_저장하지_않는다() {
        assertRejected(VALID.replaceAll("(?s),\\s*\\{\"part\":\"MOUTH\".*?\\}\\]", "]"));
        assertRejected(VALID.replaceAll("(?s)\"advice\":\\[.*\\]\\}", "\"advice\":[]}"));
    }

    private void assertRejected(String json) {
        assertThatThrownBy(() -> FaceReadingResult.validate(mapper.readTree(json)))
                .isInstanceOf(FaceReadingFailure.class)
                .extracting(e -> ((FaceReadingFailure) e).code())
                .isEqualTo(FaceReadingFailure.AI_REJECTED);
    }
}
