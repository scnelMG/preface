package com.preface.api.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class AdminPropertiesTest {

    @Test
    void 값이_없으면_local이다() {
        assertThat(new AdminProperties(null).environment()).isEqualTo("local");
        assertThat(new AdminProperties(" ").environment()).isEqualTo("local");
    }

    @Test
    void 배포_STAGE_값을_그대로_쓰고_prod만_운영이다() {
        assertThat(new AdminProperties("prod").isProduction()).isTrue();
        assertThat(new AdminProperties("PROD").environment()).isEqualTo("prod");
        assertThat(new AdminProperties("dev").isProduction()).isFalse();
    }

    @Test
    void 모르는_값이면_앱이_뜨지_않는다() {
        assertThatThrownBy(() -> new AdminProperties("production"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
