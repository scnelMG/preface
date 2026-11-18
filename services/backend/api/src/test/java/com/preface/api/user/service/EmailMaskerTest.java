package com.preface.api.user.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class EmailMaskerTest {

    @Test
    void 첫_글자와_도메인만_남긴다() {
        assertThat(EmailMasker.mask("minseo@kakao.com")).isEqualTo("m***@kakao.com");
    }

    @Test
    void 이메일이_없으면_null() {
        assertThat(EmailMasker.mask(null)).isNull();
    }

    @Test
    void 형식이_이상하면_전부_가린다() {
        assertThat(EmailMasker.mask("@kakao.com")).isEqualTo("***");
        assertThat(EmailMasker.mask("no-at-sign")).isEqualTo("***");
    }
}
