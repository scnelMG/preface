package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class SimulationTitleTest {

    private static final String BASE = "2026.10.23 시안";

    @Test
    void 같은_이름이_없으면_날짜_이름을_그대로_쓴다() {
        assertThat(SimulationService.nextTitle(BASE, List.of("2026.10.22 시안"))).isEqualTo(BASE);
    }

    @Test
    void 겹치면_2부터_비어_있는_가장_작은_번호를_붙인다() {
        assertThat(SimulationService.nextTitle(BASE, List.of(BASE))).isEqualTo(BASE + " 2");
        assertThat(SimulationService.nextTitle(BASE, List.of(BASE, BASE + " 2", BASE + " 4")))
                .isEqualTo(BASE + " 3");
    }
}
