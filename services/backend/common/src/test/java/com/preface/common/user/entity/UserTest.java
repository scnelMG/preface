package com.preface.common.user.entity;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class UserTest {

    @Test
    void 가입한_회원은_일반_권한이고_관리자가_아니다() {
        User user = User.join("합성닉네임", "synthetic@example.test");

        assertThat(user.getRole()).isEqualTo(UserRole.USER);
        assertThat(user.isActiveAdmin()).isFalse();
    }

    @Test
    void 탈퇴하면_닉네임과_이메일이_비고_WITHDRAWN과_탈퇴_시각이_남는다() {
        User user = User.join("합성닉네임", "synthetic@example.test");
        Instant now = Instant.parse("2026-10-23T00:00:00Z");

        user.withdraw(now);

        assertThat(user.getNickname()).isNull();
        assertThat(user.getEmail()).isNull();
        assertThat(user.getStatus()).isEqualTo(UserStatus.WITHDRAWN);
        assertThat(user.getDeletedAt()).isEqualTo(now);
        assertThat(user.isActive()).isFalse();
    }
}
