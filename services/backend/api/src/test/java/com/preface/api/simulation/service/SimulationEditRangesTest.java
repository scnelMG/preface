package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.simulation.dto.EyeCapabilities;
import com.preface.api.simulation.dto.ModelEditRanges;
import com.preface.api.simulation.dto.NoseCapabilities;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class SimulationEditRangesTest {
    @Test
    void 승인된_모델의_편집_항목만_원래_엔진_단위로_표시한다() {
        var catalog =
                Map.of(
                        "contour.cheekbone", new MorphRange("contour.cheekbone", "광대", -1, 1),
                        "contour.jaw_angle", new MorphRange("contour.jaw_angle", "턱", -1, 1),
                        "contour.weight_shape",
                                new MorphRange("contour.weight_shape", "체중 변화", -1, 1));
        var nose =
                new NoseCapabilities(
                        "topology",
                        "rig",
                        "engine",
                        Map.of("nose.bridge_height", new NoseCapabilities.Range(-.25, .75)));
        var eye =
                new EyeEditService.Support(
                        null,
                        new EyeCapabilities(
                                "v2",
                                "mesh",
                                "rig",
                                "parts",
                                "engine",
                                "rig",
                                "topology",
                                Map.of("inner", 30.0, "outline:height", 0.0)),
                        null);

        var ranges =
                SimulationService.editRanges(
                        catalog, nose, eye, false, Set.of("contour.cheekbone"));

        assertThat(ranges.weights())
                .containsExactlyInAnyOrderEntriesOf(
                        Map.of(
                                "nose.bridge_height", new ModelEditRanges.Range(-.25, .75),
                                "contour.cheekbone", new ModelEditRanges.Range(-1, 1)));
        assertThat(ranges.eyes())
                .containsExactlyEntriesOf(Map.of("inner", new ModelEditRanges.Range(0, 30)));
        assertThat(SimulationService.editRanges(catalog, null, null, true, Set.of()).weights())
                .containsExactlyEntriesOf(
                        Map.of("contour.weight_shape", new ModelEditRanges.Range(-1, 1)));
    }
}
