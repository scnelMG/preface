package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class NoseEditValidationTest {

    private static final String BRIDGE = "nose.bridge_height";
    private static final NoseEditValidation.Binding APPROVED =
            new NoseEditValidation.Binding("mesh", "rig", "fit", "engine", "v1", "topology");
    private static final Map<String, MorphRange> SUPPORTED =
            Map.of(BRIDGE, new MorphRange(BRIDGE, "콧대 높이", -0.4, 0.6));

    @Test
    void 승인된_모델의_검사된_실제값만_받는다() {
        Map<String, Double> actual =
                NoseEditValidation.requireSafeActual(
                        APPROVED,
                        SUPPORTED,
                        Map.of(BRIDGE, 0.2),
                        Map.of(BRIDGE, 0.5),
                        result(Map.of(BRIDGE, 0.35)));

        assertThat(actual).containsEntry(BRIDGE, 0.35);
    }

    @Test
    void 원본이나_리그_버전이_다르면_거절한다() {
        for (NoseEditValidation.Result mismatch :
                List.of(
                        resultWithBinding("other", "rig", "fit", "engine", "v1", "topology"),
                        resultWithBinding("mesh", "other", "fit", "engine", "v1", "topology"),
                        resultWithBinding("mesh", "rig", "other", "engine", "v1", "topology"),
                        resultWithBinding("mesh", "rig", "fit", "other", "v1", "topology"),
                        resultWithBinding("mesh", "rig", "fit", "engine", "v2", "topology"),
                        resultWithBinding("mesh", "rig", "fit", "engine", "v1", "other"))) {
            assertRejected(mismatch);
        }
    }

    @Test
    void 요청과_현재값_사이_밖이나_저장_정밀도_밖의_값은_거절한다() {
        assertRejected(result(Map.of(BRIDGE, 0.6)));
        assertRejected(result(Map.of(BRIDGE, 0.3505)));
        assertRejected(result(Map.of(BRIDGE, Double.NaN)));
    }

    @Test
    void 미지원_코드와_검사_실패는_거절한다() {
        assertRejected(result(Map.of(BRIDGE, 0.35, "eye.size", 0.1)));
        assertRejected(
                new NoseEditValidation.Result(
                        false,
                        Map.of(BRIDGE, 0.35),
                        "mesh",
                        "rig",
                        "fit",
                        "engine",
                        "v1",
                        "topology",
                        true,
                        true,
                        0));
        assertRejected(
                new NoseEditValidation.Result(
                        true,
                        Map.of(BRIDGE, 0.35),
                        "mesh",
                        "rig",
                        "fit",
                        "engine",
                        "v1",
                        "topology",
                        true,
                        false,
                        0));
    }

    private static NoseEditValidation.Result result(Map<String, Double> actual) {
        return new NoseEditValidation.Result(
                true, actual, "mesh", "rig", "fit", "engine", "v1", "topology", true, true, 0);
    }

    private static NoseEditValidation.Result resultWithBinding(
            String mesh,
            String rig,
            String fit,
            String engine,
            String rigVersion,
            String topology) {
        return new NoseEditValidation.Result(
                true,
                Map.of(BRIDGE, 0.35),
                mesh,
                rig,
                fit,
                engine,
                rigVersion,
                topology,
                true,
                true,
                0);
    }

    private static void assertRejected(NoseEditValidation.Result result) {
        assertThatThrownBy(
                        () ->
                                NoseEditValidation.requireSafeActual(
                                        APPROVED,
                                        SUPPORTED,
                                        Map.of(BRIDGE, 0.2),
                                        Map.of(BRIDGE, 0.5),
                                        result))
                .isInstanceOf(NoseEditValidation.InvalidResult.class);
    }
}
