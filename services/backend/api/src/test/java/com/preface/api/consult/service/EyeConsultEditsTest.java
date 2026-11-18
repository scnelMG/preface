package com.preface.api.consult.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.preface.api.consult.dto.EditAction;
import com.preface.api.simulation.dto.EyeCapabilities;
import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.api.simulation.service.EyeEditService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EyeConsultEditsTest {
    private static final EyeCapabilities CAPS =
            new EyeCapabilities(
                    "v1",
                    "a",
                    "b",
                    "c",
                    "engine",
                    "rig",
                    "topology",
                    Map.of(
                            "inline:height", 40.0,
                            "inout:height", 40.0,
                            "outline:height", 40.0,
                            "inner", 50.0,
                            "outer", 50.0,
                            "upper", 50.0,
                            "lower", 50.0));

    @Test
    void 쌍꺼풀_모양과_높이_트임은_화면과_같은_눈_상태를_바꾼다() {
        var support = new EyeEditService.Support(new EyeReview("absent", "absent"), CAPS, "c");
        assertThat(EyeConsultEdits.allowedCodes(support, EyeEditState.initial()))
                .contains("eye.style_inout", "eye.inner")
                .doesNotContain("eye.height", "eye.double_lid_depth");

        var result =
                EyeConsultEdits.apply(
                        EyeEditState.initial(),
                        List.of(
                                action("eye.style_inout", 1),
                                action("eye.height", 1),
                                action("eye.inner", 1)),
                        support);
        assertThat(result.state().L().enabled()).isTrue();
        assertThat(result.state().R().enabled()).isTrue();
        assertThat(result.state().L().style()).isEqualTo("inout");
        assertThat(result.state().L().values().height()).isEqualTo(24);
        assertThat(result.state().R().values().inner()).isEqualTo(5);
        assertThat(result.state().L().values().crease()).isEqualTo(65);
        assertThat(result.state().L().curve()).isEqualTo(EyeEditState.curve(24, "inout"));
    }

    @Test
    void 이미_쌍꺼풀이_있는_눈은_라인을_만들지_않고_트임만_함께_바꾼다() {
        var support = new EyeEditService.Support(new EyeReview("present", "absent"), CAPS, "c");
        var changed =
                EyeConsultEdits.apply(
                                EyeEditState.initial(),
                                List.of(action("eye.style_outline", 1), action("eye.outer", 1)),
                                support)
                        .state();
        assertThat(changed.R().enabled()).isFalse();
        assertThat(changed.L().enabled()).isTrue();
        assertThat(changed.R().values().outer()).isEqualTo(5);
        assertThat(changed.L().values().outer()).isEqualTo(5);

        var bothPresent =
                new EyeEditService.Support(new EyeReview("present", "present"), CAPS, "c");
        assertThat(EyeConsultEdits.allowedCodes(bothPresent, EyeEditState.initial()))
                .contains("eye.outer")
                .noneMatch(code -> code.startsWith("eye.style_"));
    }

    @Test
    void 미승인_모델과_예전_눈_morph_코드는_편집하지_않는다() {
        var locked = new EyeEditService.Support(new EyeReview("absent", "absent"), null, "c");
        assertThat(EyeConsultEdits.allowedCodes(locked, EyeEditState.initial())).isEmpty();
        assertThatThrownBy(
                        () ->
                                EyeConsultEdits.apply(
                                        EyeEditState.initial(),
                                        List.of(action("eye.inner", 1)),
                                        locked))
                .isInstanceOf(RuntimeException.class);
        var supported = new EyeEditService.Support(new EyeReview("absent", "absent"), CAPS, "c");
        assertThatThrownBy(
                        () ->
                                EyeConsultEdits.apply(
                                        EyeEditState.initial(),
                                        List.of(action("eye.double_lid_depth", 1)),
                                        supported))
                .isInstanceOf(RuntimeException.class);
    }

    @Test
    void 눈_후보의_방향과_원문이_어긋나면_적용하지_않는다() {
        var support = new EyeEditService.Support(new EyeReview("absent", "absent"), CAPS, "c");
        for (EditAction action :
                List.of(
                        new EditAction("eye.style_inline", "both", -1, "small", "인라인 쌍꺼풀 없애줘"),
                        new EditAction("eye.style_inline", "both", 1, "small", "인라인 쌍꺼풀 빼줘"),
                        new EditAction("eye.inner", "both", 1, "small", "앞트임을 줄여줘"),
                        new EditAction("eye.upper", "both", -1, "small", "윗트임을 넓혀줘"),
                        new EditAction("eye.height", "both", 1, "small", "쌍꺼풀 높이를 낮춰줘"))) {
            assertThatThrownBy(
                            () ->
                                    EyeConsultEdits.apply(
                                            EyeEditState.initial(), List.of(action), support))
                    .as(action.source())
                    .isInstanceOf(RuntimeException.class);
        }
        assertThat(EyeConsultEdits.sourceDirectionMatches("eye.inner", -1, "앞트임을 줄여줘")).isTrue();
        assertThat(EyeConsultEdits.sourceDirectionMatches("eye.inner", 1, "앞트임을 넓혀줘")).isTrue();
    }

    private static EditAction action(String code, int direction) {
        return new EditAction(code, "both", direction, "small");
    }

    @Test
    void 상담에서_추가한_쌍꺼풀만_끄고_트임과_라인_설정은_남긴다() {
        var support = new EyeEditService.Support(new EyeReview("present", "absent"), CAPS, "c");
        var before =
                EyeConsultEdits.apply(
                                EyeEditState.initial(),
                                List.of(action("eye.style_inout", 1), action("eye.inner", 1)),
                                support)
                        .state();
        var off = new EditAction(EyeConsultEdits.FOLD_OFF, "both", 1, "small", "쌍꺼풀을 없애줘");
        var after = EyeConsultEdits.apply(before, List.of(off), support).state();
        assertThat(after.L().enabled()).isFalse();
        assertThat(after.L().values()).isEqualTo(before.L().values());
        assertThat(after.L().curve()).isEqualTo(before.L().curve());
        assertThat(after.R()).isEqualTo(before.R());
        assertThat(EyeConsultEdits.allowedCodes(support, after))
                .doesNotContain(EyeConsultEdits.FOLD_OFF);
    }
}
