package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MorphEditsTest {

    private static final Map<String, MorphRange> RANGES =
            Map.of(
                    "nose.bridge_height",
                    new MorphRange("nose.bridge_height", "콧대 높이", -0.5, 0.8),
                    "nose.tip_height",
                    new MorphRange("nose.tip_height", "코끝", -0.5, 0.5),
                    "eye.size",
                    new MorphRange("eye.size", "눈 크기", -0.5, 0.5));

    @Test
    void 범위_안의_값은_그대로_반영되고_clamped가_꺼진다() {
        MorphEdits.Applied applied =
                MorphEdits.apply(Map.of(), List.of(req("nose.bridge_height", 0.2)), RANGES);

        assertThat(applied.weights()).containsExactly(Map.entry("nose.bridge_height", 0.2));
        assertThat(applied.clamped()).isFalse();
        assertThat(applied.changes())
                .containsExactly(new MorphEdits.Change("nose.bridge_height", 0.0, 0.2, false));
    }

    @Test
    void 범위_밖의_값은_최대_최소로_잘리고_clamped가_켜진다() {
        MorphEdits.Applied applied =
                MorphEdits.apply(
                        Map.of(),
                        List.of(req("nose.bridge_height", 1.5), req("nose.tip_height", -9)),
                        RANGES);

        assertThat(applied.weights())
                .containsEntry("nose.bridge_height", 0.8)
                .containsEntry("nose.tip_height", -0.5);
        assertThat(applied.clamped()).isTrue();
    }

    @Test
    void 모르는_code가_하나라도_있으면_EDIT_001이다() {
        assertThatThrownBy(
                        () ->
                                MorphEdits.apply(
                                        Map.of(),
                                        List.of(req("nose.bridge_height", 0.1), req("jaw.x", 0.1)),
                                        RANGES))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(EditErrorCode.UNKNOWN_MORPH_CODE));
    }

    @Test
    void 활성_눈_코드가_코와_함께_와도_전체를_거절한다() {
        assertThatThrownBy(
                        () ->
                                MorphEdits.apply(
                                        Map.of("eye.size", 0.1),
                                        List.of(
                                                req("nose.bridge_height", 0.2),
                                                req("eye.size", 0.3)),
                                        RANGES))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(EditErrorCode.UNKNOWN_MORPH_CODE));
    }

    @Test
    void 되돌리기에서_기존_눈_값은_유지하고_코_윤곽_값만_바꿀_수_있다() {
        assertThat(
                        MorphEdits.preservesLocked(
                                Map.of("eye.size", 0.2, "nose.bridge_height", 0.3),
                                Map.of("eye.size", 0.2)))
                .isTrue();
        assertThat(
                        MorphEdits.preservesLocked(
                                Map.of("eye.size", 0.2),
                                Map.of("eye.size", 0.2, "contour.jaw_angle", -0.4)))
                .isTrue();
        assertThat(MorphEdits.preservesLocked(Map.of("eye.size", 0.2), Map.of("eye.size", 0.3)))
                .isFalse();
    }

    @Test
    void 윤곽_코드는_카탈로그에_있으면_저장하고_범위로_자른다() {
        Map<String, MorphRange> ranges =
                Map.of(
                        "contour.cheekbone",
                        new MorphRange("contour.cheekbone", "광대 크기", -1, 1),
                        "nose.bridge_height",
                        new MorphRange("nose.bridge_height", "콧대 높이", -0.5, 0.8));

        MorphEdits.Applied applied =
                MorphEdits.apply(
                        Map.of("nose.bridge_height", 0.2),
                        List.of(req("contour.cheekbone", 1.7)),
                        ranges);

        assertThat(applied.weights())
                .containsEntry("contour.cheekbone", 1.0)
                .containsEntry("nose.bridge_height", 0.2);
        assertThat(applied.clamped()).isTrue();
        assertThat(MorphEdits.summary(applied.changes(), ranges)).isEqualTo("광대 크기 변경");
        assertThatThrownBy(
                        () ->
                                MorphEdits.apply(
                                        Map.of(), List.of(req("contour.unknown", 0.1)), ranges))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(EditErrorCode.UNKNOWN_MORPH_CODE));
    }

    @Test
    void 검사기_실제값은_코에만_반영하고_윤곽은_후보값을_유지한다() {
        Map<String, MorphRange> ranges =
                Map.of(
                        "contour.chin_length",
                        new MorphRange("contour.chin_length", "턱끝 길이", -1, 1),
                        "nose.bridge_height",
                        new MorphRange("nose.bridge_height", "콧대 높이", -0.5, 0.8));
        Map<String, Double> current = Map.of("contour.chin_length", 0.1);
        MorphEdits.Applied candidate =
                MorphEdits.apply(
                        current,
                        List.of(req("nose.bridge_height", 0.6), req("contour.chin_length", 0.4)),
                        ranges);

        MorphEdits.Applied applied =
                MorphEdits.withActual(current, candidate, Map.of("nose.bridge_height", 0.45));

        assertThat(applied.weights())
                .containsExactly(
                        Map.entry("contour.chin_length", 0.4),
                        Map.entry("nose.bridge_height", 0.45));
        assertThat(applied.changes())
                .containsExactly(
                        new MorphEdits.Change("nose.bridge_height", 0.0, 0.45, true),
                        new MorphEdits.Change("contour.chin_length", 0.1, 0.4, false));
    }

    @Test
    void 값이_0이_되면_키를_지우고_다른_키는_유지한다() {
        MorphEdits.Applied applied =
                MorphEdits.apply(
                        Map.of("nose.bridge_height", 0.3, "eye.size", 0.1),
                        List.of(req("nose.bridge_height", 0)),
                        RANGES);

        assertThat(applied.weights()).containsExactly(Map.entry("eye.size", 0.1));
        assertThat(applied.changes().getFirst().from()).isEqualTo(0.3);
    }

    @Test
    void 값은_소수_셋째_자리로_반올림하고_같은_code는_마지막_값을_쓴다() {
        MorphEdits.Applied applied =
                MorphEdits.apply(
                        Map.of(),
                        List.of(req("nose.tip_height", 0.4), req("nose.tip_height", 0.12345)),
                        RANGES);

        assertThat(applied.weights()).containsExactly(Map.entry("nose.tip_height", 0.123));
        assertThat(applied.changes()).hasSize(1);
    }

    @Test
    void 검사된_실제값으로_코_상태와_이력을_맞추고_기존_눈은_보존한다() {
        Map<String, Double> current =
                Map.of("eye.size", 0.2, "nose.bridge_height", 0.2, "nose.tip_height", 0.1);
        MorphEdits.Applied candidate =
                MorphEdits.apply(
                        current,
                        List.of(req("nose.bridge_height", 0.5), req("nose.tip_height", 0.2)),
                        RANGES);

        MorphEdits.Applied applied =
                MorphEdits.withActual(
                        current,
                        candidate,
                        Map.of("nose.bridge_height", 0.35, "nose.tip_height", 0.2));

        assertThat(applied.weights())
                .containsEntry("eye.size", 0.2)
                .containsEntry("nose.bridge_height", 0.35)
                .containsEntry("nose.tip_height", 0.2);
        assertThat(applied.changes())
                .containsExactly(
                        new MorphEdits.Change("nose.bridge_height", 0.2, 0.35, true),
                        new MorphEdits.Change("nose.tip_height", 0.1, 0.2, false));
        assertThat(applied.clamped()).isTrue();
    }

    @Test
    void 요약은_항목_이름으로_만들고_세_개부터는_외_N개로_줄인다() {
        assertThat(MorphEdits.summary(List.of(change("nose.bridge_height")), RANGES))
                .isEqualTo("콧대 높이 변경");
        assertThat(
                        MorphEdits.summary(
                                List.of(change("nose.bridge_height"), change("nose.tip_height")),
                                RANGES))
                .isEqualTo("콧대 높이, 코끝 변경");
        assertThat(
                        MorphEdits.summary(
                                List.of(
                                        change("nose.bridge_height"),
                                        change("nose.tip_height"),
                                        change("eye.size")),
                                RANGES))
                .isEqualTo("콧대 높이 외 2개 변경");
    }

    @Test
    void 코끝_앞뒤_요약은_화면_이름을_사용한다() {
        assertThat(
                        MorphEdits.summary(
                                List.of(change("nose.tip_projection")),
                                Map.of(
                                        "nose.tip_projection",
                                        new MorphRange("nose.tip_projection", "코끝 돌출", -1, 1))))
                .isEqualTo("코끝 앞뒤 변경");
    }

    @Test
    void 요약은_요청에_포함됐어도_실제로_바뀌지_않은_항목을_세지_않는다() {
        assertThat(
                        MorphEdits.summary(
                                List.of(
                                        new MorphEdits.Change("nose.tip_height", 0.1, 0.1, false),
                                        change("nose.bridge_height")),
                                RANGES))
                .isEqualTo("콧대 높이 변경");
    }

    @Test
    void 결속된_코끝_높이와_회전은_사용자_조절_한_항목으로_센다() {
        Map<String, MorphRange> ranges =
                Map.of(
                        "nose.tip_height", new MorphRange("nose.tip_height", "코끝", -1, 1),
                        "nose.tip_rotation", new MorphRange("nose.tip_rotation", "코끝 회전", -1, 1),
                        "nose.alar_width", new MorphRange("nose.alar_width", "콧볼 너비", -1, 1));
        List<MorphEdits.Change> coupled =
                List.of(
                        new MorphEdits.Change("nose.tip_height", 0, -0.24, false),
                        new MorphEdits.Change("nose.tip_rotation", 0, -0.16, false),
                        new MorphEdits.Change("nose.alar_width", 0, -0.4, false));
        assertThat(MorphEdits.summary(coupled, ranges)).isEqualTo("코끝 위아래, 콧볼 너비 변경");
        assertThat(MorphEdits.summary(List.of(coupled.get(0), coupled.get(1)), ranges))
                .isEqualTo("코끝 위아래 변경");

        List<MorphEdits.Change> legacy =
                List.of(
                        new MorphEdits.Change("nose.tip_height", 0.24, 0.1, false),
                        new MorphEdits.Change("nose.tip_rotation", -0.16, -0.1, false));
        assertThat(MorphEdits.summary(legacy, ranges)).isEqualTo("코끝, 코끝 회전 변경");
    }

    @Test
    void 되돌리기_문구는_받침에_맞춰_을_를을_붙인다() {
        assertThat(MorphEdits.undoneSummary("콧대 높이 변경")).isEqualTo("콧대 높이 변경을 취소했어요.");
        assertThat(MorphEdits.undoneSummary("초기화")).isEqualTo("초기화를 취소했어요.");
        assertThat(MorphEdits.redoneSummary("콧대 높이 변경")).isEqualTo("콧대 높이 변경을 다시 적용했어요.");
    }

    private static MorphEdits.Requested req(String code, double value) {
        return new MorphEdits.Requested(code, value);
    }

    private static MorphEdits.Change change(String code) {
        return new MorphEdits.Change(code, 0, 0.1, false);
    }
}
