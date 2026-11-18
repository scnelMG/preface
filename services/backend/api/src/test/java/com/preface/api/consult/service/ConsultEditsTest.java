package com.preface.api.consult.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.preface.api.consult.dto.EditAction;
import com.preface.api.simulation.service.MorphEdits;
import com.preface.api.simulation.service.MorphRange;
import com.preface.common.error.BusinessException;
import com.preface.common.error.ConsultErrorCode;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class ConsultEditsTest {

    @Test
    void 상담_절대값은_코끝_위아래의_공통_승인_범위에서_현재값과_무관하게_환산한다() {
        var action = SliderConsultRequest.parse("코끝 위아래를 정확히 50%로 설정해줘");
        assertThat(action).isNotNull();
        var ranges =
                Map.of(
                        "nose.tip_height", new MorphRange("nose.tip_height", "높이", -0.3, 0.6),
                        "nose.tip_rotation", new MorphRange("nose.tip_rotation", "회전", -0.4, 0.4));
        assertThat(
                        ConsultEdits.requested(
                                List.of(action),
                                Map.of("nose.tip_height", 0.2),
                                ranges.keySet(),
                                ranges))
                .containsExactly(
                        new MorphEdits.Requested("nose.tip_height", -0.15),
                        new MorphEdits.Requested("nose.tip_rotation", -0.1));
        assertThat(SliderConsultRequest.parse("콧대 높이를 35%로 맞추지 마")).isNull();
        assertThat(SliderConsultRequest.parse("체중 변화 강도를 30%로 맞춰줘")).isNull();
    }

    @ParameterizedTest
    @CsvSource({"1, -0.003, -0.002", "-1, 0.003, 0.002"})
    void 코끝_위아래_채팅은_반올림_경계에서_직접_조절과_같은_높이와_회전을_요청한다(int target, double height, double rotation) {
        var action = SliderConsultRequest.parse("코끝 위아래를 " + target + "로 맞춰줘");
        assertThat(action).isNotNull();
        var ranges =
                Map.of(
                        "nose.tip_height", new MorphRange("nose.tip_height", "높이", -0.25, 0.25),
                        "nose.tip_rotation", new MorphRange("nose.tip_rotation", "회전", -0.4, 0.4));
        assertThat(ConsultEdits.requested(List.of(action), Map.of(), ranges.keySet(), ranges))
                .containsExactly(
                        new MorphEdits.Requested("nose.tip_height", height),
                        new MorphEdits.Requested("nose.tip_rotation", rotation));
    }

    private static final Set<String> V2 =
            Set.of(
                    "eye.tail_angle.left",
                    "eye.tail_angle.right",
                    "nose.tip_projection",
                    "nose.tip_height",
                    "nose.tip_rotation");

    @Test
    void 상담_절대값은_승인된_한쪽과_중립만_요청한다() {
        var ranges =
                Map.of("nose.bridge_height", new MorphRange("nose.bridge_height", "콧대", 0, 0.5));
        var positive = SliderConsultRequest.parse("콧대 높이를 50%로 맞춰줘");
        var neutral = SliderConsultRequest.parse("콧대 높이를 0%로 맞춰줘");
        var negative = SliderConsultRequest.parse("콧대 높이를 -50%로 맞춰줘");

        assertThat(ConsultEdits.requested(List.of(positive), Map.of(), ranges.keySet(), ranges))
                .containsExactly(new MorphEdits.Requested("nose.bridge_height", 0.25));
        assertThat(ConsultEdits.requested(List.of(neutral), Map.of(), ranges.keySet(), ranges))
                .containsExactly(new MorphEdits.Requested("nose.bridge_height", 0));
        assertThatThrownBy(
                        () ->
                                ConsultEdits.requested(
                                        List.of(negative), Map.of(), ranges.keySet(), ranges))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ConsultErrorCode.NOT_APPLICABLE));
    }

    @Test
    void 좌우를_말하지_않은_눈_요청은_본인_기준_양쪽_코드로_풀린다() {
        assertThat(ConsultEdits.storageCodes(action("eye.tail_angle", "both", 1, "small")))
                .containsExactly("eye.tail_angle.left", "eye.tail_angle.right");
        assertThat(ConsultEdits.storageCodes(action("eye.tail_angle", "right", 1, "small")))
                .containsExactly("eye.tail_angle.right");
        assertThat(ConsultEdits.storageCodes(action("nose.tip_height", "both", -1, "small")))
                .containsExactly("nose.tip_height", "nose.tip_rotation");
    }

    @Test
    void 복합_요청은_현재값에_방향과_강도만큼_더한_요청값이_된다() {
        List<MorphEdits.Requested> requested =
                ConsultEdits.requested(
                        List.of(
                                action("nose.tip_projection", "both", 1, "small"),
                                action("nose.tip_height", "both", -1, "medium")),
                        Map.of("nose.tip_projection", 0.3),
                        V2);

        assertThat(requested)
                .containsExactly(
                        new MorphEdits.Requested("nose.tip_projection", 0.4),
                        new MorphEdits.Requested("nose.tip_height", -0.12),
                        new MorphEdits.Requested("nose.tip_rotation", -0.08));
    }

    @Test
    void 시안_스키마에_없는_코드가_섞이면_부분_적용하지_않고_CON_010이다() {
        assertThatThrownBy(
                        () ->
                                ConsultEdits.requested(
                                        List.of(
                                                action("nose.tip_height", "both", 1, "small"),
                                                action("eye.open", "both", 1, "small")),
                                        Map.of(),
                                        V2))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ConsultErrorCode.NOT_APPLICABLE));
    }

    @Test
    void 화면에_없는_코_효과는_상담_적용에서_거절한다() {
        assertThatThrownBy(
                        () ->
                                ConsultEdits.requested(
                                        List.of(action("nose.alar_flare", "both", 1, "small")),
                                        Map.of(),
                                        Set.of("nose.alar_flare")))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ConsultErrorCode.NOT_APPLICABLE));
    }

    @Test
    void 윤곽과_체중_후보는_슬라이더_저장_코드로_변환하고_좌우나_미지원_코드는_거절한다() {
        assertThat(
                        ConsultEdits.requested(
                                List.of(action("contour.weight_shape", "both", -1, "small")),
                                Map.of(),
                                Set.of("contour.weight_shape")))
                .containsExactly(new MorphEdits.Requested("contour.weight_shape", -0.1));
        assertThat(ConsultEdits.part(List.of(action("contour.cheekbone", "both", 1, "small"))))
                .isEqualTo("CONTOUR");
        assertThat(ConsultEdits.isValid(action("contour.cheekbone", "left", 1, "small"))).isFalse();
        assertThatThrownBy(
                        () ->
                                ConsultEdits.requested(
                                        List.of(action("contour.unknown", "both", 1, "small")),
                                        Map.of(),
                                        Set.of("contour.unknown")))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void AI에_보내는_허용_코드는_v2_저장_코드_모양만_남긴다() {
        assertThat(
                        ConsultEdits.allowedCodes(
                                List.of(
                                        "nose.bridge_height",
                                        "eye.size",
                                        "eye.tail_angle",
                                        "eye.open.left",
                                        "contour.jaw")))
                .containsExactly("eye.open.left", "nose.bridge_height");
    }

    @Test
    void 코에_좌우를_붙이거나_모르는_강도면_형식_위반이다() {
        assertThat(ConsultEdits.isValid(action("nose.tip_height", "left", 1, "small"))).isFalse();
        assertThat(ConsultEdits.isValid(action("eye.open", "both", 1, "huge"))).isFalse();
        assertThat(ConsultEdits.isValid(action("eye.open", "both", 0, "small"))).isFalse();
        assertThat(ConsultEdits.isValid(action("lip.volume", "both", 1, "small"))).isFalse();
        assertThat(ConsultEdits.isValid(action("eye.open", "left", -1, "large"))).isTrue();
    }

    @Test
    void 강도를_말하지_않은_후보는_small로_채우고_말한_강도는_그대로_둔다() {
        assertThat(ConsultEdits.withDefaultStrength(action("eye.open", "both", 1, null)))
                .isEqualTo(action("eye.open", "both", 1, "small"));
        assertThat(ConsultEdits.withDefaultStrength(action("eye.open", "both", 1, " ")))
                .isEqualTo(action("eye.open", "both", 1, "small"));
        assertThat(ConsultEdits.withDefaultStrength(action("eye.open", "both", 1, "large")))
                .isEqualTo(action("eye.open", "both", 1, "large"));
        assertThat(
                        ConsultEdits.withDefaultStrength(action("eye.open", "both", 1, "huge"))
                                .strength())
                .as("모르는 강도는 바꾸지 않고 형식 검사가 거른다")
                .isEqualTo("huge");
    }

    @Test
    void 덜은_직전_효과를_반대_방향_작은_단계로_더는_같은_방향으로_만든다() {
        List<EditAction> previous = List.of(action("eye.tail_angle", "right", 1, "large"));

        assertThat(ConsultEdits.adjust(previous, false))
                .containsExactly(action("eye.tail_angle", "right", -1, "small"));
        assertThat(ConsultEdits.adjust(previous, true))
                .containsExactly(action("eye.tail_angle", "right", 1, "small"));
    }

    @Test
    void 한_부위면_part를_섞이면_null을_준다() {
        assertThat(ConsultEdits.part(List.of(action("nose.tip_height", "both", 1, "small"))))
                .isEqualTo("NOSE");
        assertThat(
                        ConsultEdits.part(
                                List.of(
                                        action("nose.tip_height", "both", 1, "small"),
                                        action("eye.open", "both", 1, "small"))))
                .isNull();
    }

    private static EditAction action(String code, String side, int direction, String strength) {
        return new EditAction(code, side, direction, strength);
    }
}
