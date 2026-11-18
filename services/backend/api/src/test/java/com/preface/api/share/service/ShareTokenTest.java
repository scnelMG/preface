package com.preface.api.share.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class ShareTokenTest {

    @Test
    void 토큰은_43자_base64url이다() {
        assertThat(ShareToken.generate()).matches("^[A-Za-z0-9_-]{43}$");
    }

    @Test
    void 토큰은_매번_다르다() {
        Set<String> tokens = new HashSet<>();
        for (int i = 0; i < 1000; i++) {
            tokens.add(ShareToken.generate());
        }
        assertThat(tokens).hasSize(1000);
    }

    @Test
    void 해시는_44자이고_같은_입력은_같은_해시다() {
        assertThat(ShareToken.hash("a")).hasSize(44);
        assertThat(ShareToken.hash("a")).isEqualTo(ShareToken.hash("a"));
        assertThat(ShareToken.hash("a")).isNotEqualTo(ShareToken.hash("b"));
    }

    @Test
    void 형식이_틀린_토큰은_거른다() {
        assertThat(ShareToken.wellFormed(ShareToken.generate())).isTrue();
        assertThat(ShareToken.wellFormed(null)).isFalse();
        assertThat(ShareToken.wellFormed("")).isFalse();
        assertThat(ShareToken.wellFormed("a/b")).isFalse();
        assertThat(ShareToken.wellFormed("x".repeat(1000))).isFalse();
        assertThat(ShareToken.wellFormed("x".repeat(42) + "/")).isFalse();
    }
}
