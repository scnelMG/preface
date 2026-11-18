package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ChangedPartsTest {

    private static final Map<String, ChangedParts.PartOf> PARTS = new LinkedHashMap<>();

    static {
        PARTS.put("nose.bridge_height", new ChangedParts.PartOf("NOSE", 0.0));
        PARTS.put("nose.tip_height", new ChangedParts.PartOf("NOSE", 0.0));
        PARTS.put("eye.size", new ChangedParts.PartOf("EYE", 0.0));
    }

    @Test
    void 기본값과_다른_가중치가_있는_부위만_sort_order_순으로_한_번씩_나온다() {
        assertThat(
                        ChangedParts.of(
                                Map.of(
                                        "eye.size",
                                        0.1,
                                        "nose.tip_height",
                                        -0.1,
                                        "nose.bridge_height",
                                        0.2),
                                PARTS))
                .containsExactly("NOSE", "EYE");
    }

    @Test
    void 기본값으로_되돌린_항목과_모르는_code는_변경으로_보지_않는다() {
        assertThat(ChangedParts.of(Map.of("eye.size", 0.0, "contour.jaw_width", 0.3), PARTS))
                .isEmpty();
    }

    @Test
    void 가중치가_비면_변경_부위도_없다() {
        assertThat(ChangedParts.of(Map.of(), PARTS)).isEmpty();
    }
}
