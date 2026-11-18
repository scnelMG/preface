package com.preface.api.consult.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.consult.service.ConsultCorrection.Control;
import org.junit.jupiter.api.Test;

class ConsultCorrectionTest {
    @Test
    void 유지할_콧대를_정정_대상에서_빼고_코끝_후보만_고른다() {
        var intent = ConsultCorrection.parse("콧대는 그대로 두고 아까 바꾼 코끝만 되돌려줘").orElseThrow();
        assertThat(intent.targets()).containsExactly(Control.TIP_VERTICAL, Control.TIP_PROJECTION);
        assertThat(intent.partial()).isFalse();
    }

    @Test
    void 모호한_강도_정정과_전체_되돌리기와_금지_지시를_구분한다() {
        assertThat(ConsultCorrection.parse("아까 거 조금만 줄여줘").orElseThrow().partial()).isTrue();
        assertThat(ConsultCorrection.parse("되돌려줘")).isEmpty();
        assertThat(ConsultCorrection.parse("코끝은 되돌리지 말아줘")).isEmpty();
        assertThat(ConsultCorrection.parse("코끝만 되돌려줘라고 쓰면 어떻게 돼?")).isEmpty();
    }
}
