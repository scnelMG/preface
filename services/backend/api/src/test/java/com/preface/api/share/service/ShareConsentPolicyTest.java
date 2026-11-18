package com.preface.api.share.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.common.consent.entity.ConsentDocument;
import com.preface.common.consent.entity.ConsentType;
import com.preface.common.consent.entity.UserConsent;
import com.preface.common.consent.repository.UserConsentRepository;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ShareConsentPolicyTest {

    private static final String USER = "user-1";
    private static final Instant NOW = Instant.parse("2026-11-20T00:00:00Z");

    private final UserRepository users = mock(UserRepository.class);
    private final UserConsentRepository consents = mock(UserConsentRepository.class);
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final User user = mock(User.class);

    @BeforeEach
    void setUp() {
        when(users.findById(USER)).thenReturn(Optional.of(user));
        when(user.isActive()).thenReturn(true);
    }

    private ShareConsentPolicy policy(String minVersion) {
        return new ShareConsentPolicy(
                users,
                consents,
                clock,
                new ShareProperties("https://preface.example", minVersion, Duration.ofDays(7)));
    }

    private void latest(boolean agreed, String version, Instant effectiveAt) {
        ConsentDocument doc = mock(ConsentDocument.class);
        when(doc.getVersion()).thenReturn(version);
        when(doc.getEffectiveAt()).thenReturn(effectiveAt);
        UserConsent consent = mock(UserConsent.class);
        when(consent.isAgreed()).thenReturn(agreed);
        when(consent.getConsentDocument()).thenReturn(doc);
        when(consents.findFirstByUser_IdAndConsentTypeOrderByActedAtDesc(
                        USER, ConsentType.FACE_PUBLIC))
                .thenReturn(Optional.of(consent));
    }

    @Test
    void 최소_버전_설정이_없으면_항상_동의_없음이다() {
        latest(true, "2026-11-v1", NOW.minusSeconds(60));

        assertThat(policy("").canShare(USER)).isFalse();
        assertThat(policy(null).canShare(USER)).isFalse();
    }

    @Test
    void 기본_최소_버전은_가입_때_받는_v1이라_v1_동의_회원은_바로_공유할_수_있다() throws Exception {
        // 2026-11-10 사용자 결정(S15P31B204-749): 새 버전 재동의 없이 가입 때 받은 FACE_PUBLIC v1(필수)로 공유를 연다
        String yml;
        try (var in = getClass().getResourceAsStream("/application.yml")) {
            yml = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
        assertThat(yml)
                .contains("face-public-min-version: ${SHARE_FACE_PUBLIC_MIN_VERSION:2026-10-v1}");

        latest(true, "2026-10-v1", Instant.parse("2026-10-25T15:00:00Z"));
        assertThat(policy("2026-10-v1").canShare(USER)).isTrue();
    }

    @Test
    void 최신_기록이_최소_버전_이상_동의면_공유할_수_있다() {
        latest(true, "2026-11-v1", NOW.minusSeconds(60));

        assertThat(policy("2026-11-v1").canShare(USER)).isTrue();
    }

    @Test
    void v1에만_동의했으면_공유할_수_없다() {
        latest(true, "2026-10-v1", NOW.minusSeconds(60));

        assertThat(policy("2026-11-v1").canShare(USER)).isFalse();
    }

    @Test
    void 마지막_기록이_철회면_공유할_수_없다() {
        latest(false, "2026-11-v1", NOW.minusSeconds(60));

        assertThat(policy("2026-11-v1").canShare(USER)).isFalse();
    }

    @Test
    void 탈퇴한_회원은_공유할_수_없다() {
        latest(true, "2026-11-v1", NOW.minusSeconds(60));
        when(user.isActive()).thenReturn(false);

        assertThat(policy("2026-11-v1").canShare(USER)).isFalse();
    }

    @Test
    void 시행일이_지나지_않은_문서면_공유할_수_없다() {
        latest(true, "2026-11-v1", NOW.plusSeconds(60));

        assertThat(policy("2026-11-v1").canShare(USER)).isFalse();
    }

    @Test
    void 최소_버전과_상관없이_최신_동의가_유지되면_공개_상태다() {
        latest(true, "2026-10-v1", NOW.minusSeconds(60));
        assertThat(policy("2026-11-v1").stillPublic(USER)).isTrue();

        latest(false, "2026-10-v1", NOW.minusSeconds(60));
        assertThat(policy("2026-11-v1").stillPublic(USER)).isFalse();
    }

    @Test
    void 동의_기록이_없으면_공개_상태가_아니다() {
        when(consents.findFirstByUser_IdAndConsentTypeOrderByActedAtDesc(
                        USER, ConsentType.FACE_PUBLIC))
                .thenReturn(Optional.empty());

        assertThat(policy("2026-11-v1").stillPublic(USER)).isFalse();
    }
}
