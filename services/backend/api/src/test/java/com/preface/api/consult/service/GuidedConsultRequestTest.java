package com.preface.api.consult.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.consult.dto.EditAction;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class GuidedConsultRequestTest {
    @Test
    void 분명한_방향은_선택한_축에서만_후보가_된다() {
        String content = "그럼 조금 올려줘";
        var request = GuidedConsultRequest.parse(content);

        assertThat(request.action("nose.tip_height", content))
                .isEqualTo(new EditAction("nose.tip_height", "both", 1, "small", content));
        assertThat(request.action("nose.tip_projection", content)).isNull();
        assertThat(request.action("eye.style_inline", content)).isNull();
    }

    @Test
    void 안내_직후에도_아주와_아주_조금의_강도를_구분한다() {
        for (String content : new String[] {"그럼 아주 줄여줘", "그럼 아주 조금 줄여줘"}) {
            assertThat(GuidedConsultRequest.parse(content).action("contour.jaw_angle", content))
                    .isEqualTo(
                            new EditAction(
                                    "contour.jaw_angle",
                                    "both",
                                    -1,
                                    content.contains("조금") ? "small" : "large",
                                    content));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"그럼 거기만 조금 줄여줘", "거기만 조금 줄여줘", "그러면 그거를 조금 줄여줘"})
    void 지칭이_있어도_직전_안내의_축만_사용한다(String content) {
        assertThat(GuidedConsultRequest.parse(content).action("nose.alar_width", content))
                .isEqualTo(new EditAction("nose.alar_width", "both", -1, "small", content));
    }

    @Test
    void 직접_조절에서_고른_코끝만_후보로_만들고_복합과_부정은_거절한다() {
        String content = "여기만 조금 올려줘";
        assertThat(GuidedConsultRequest.parseDirect(content).action("nose.tip_height", content))
                .isEqualTo(new EditAction("nose.tip_height", "both", 1, "small", content));
        assertThat(GuidedConsultRequest.parseDirect(content).action("nose.tip_projection", content))
                .isNull();
        assertThat(GuidedConsultRequest.parseDirect("여기만 올리고 콧볼을 좁혀줘")).isNull();
        assertThat(GuidedConsultRequest.parseDirect("여기만 올리지 말아줘")).isNull();
        assertThat(GuidedConsultRequest.parseDirect("여기만 조금 해줘").action("nose.tip_height", content))
                .isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"조금만", "그럼 조금만 해줘", "좋아요"})
    void 정도나_동의만으로_방향을_정하지_않는다(String content) {
        assertThat(GuidedConsultRequest.parse(content).action("nose.tip_height", content)).isNull();
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "콧대를 올려줘",
                "올리지 말아줘",
                "올려도 돼요?",
                "오른쪽만 올려줘",
                "그럼 거기만 줄이지 말아줘",
                "거기만 줄여도 될까요?",
                "거기만 줄이고 콧대도 높여줘"
            })
    void 새_대상과_부정_질문_좌우는_후속_방향으로_해석하지_않는다(String content) {
        assertThat(GuidedConsultRequest.parse(content)).isNull();
    }
}
