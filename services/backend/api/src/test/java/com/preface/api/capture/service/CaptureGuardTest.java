package com.preface.api.capture.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.common.consent.entity.ConsentType;
import com.preface.common.consent.entity.UserConsent;
import com.preface.common.consent.repository.UserConsentRepository;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CaptureErrorCode;
import com.preface.common.error.ErrorCode;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class CaptureGuardTest {

    private static final String USER_ID = "00000000-0000-0000-0000-000000000002";

    private final UserRepository userRepository = mock(UserRepository.class);
    private final UserConsentRepository consentRepository = mock(UserConsentRepository.class);
    private final JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
    private final CaptureGuard guard =
            new CaptureGuard(userRepository, consentRepository, jdbcTemplate);

    @BeforeEach
    void setUp() {
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(User.join("테스트", null)));
        faceDataAgreed(true);
        activeJobs(0);
    }

    @Test
    void 동의했고_진행_중_작업이_없으면_통과한다() {
        assertThat(guard.requireReady(USER_ID)).isNotNull();
    }

    @Test
    void 얼굴_동의_기록이_없거나_최근_기록이_철회면_CAP_001() {
        when(consentRepository.findFirstByUser_IdAndConsentTypeOrderByActedAtDesc(
                        USER_ID, ConsentType.FACE_DATA))
                .thenReturn(Optional.empty());
        assertError(CaptureErrorCode.FACE_DATA_CONSENT_REQUIRED);

        faceDataAgreed(false);
        assertError(CaptureErrorCode.FACE_DATA_CONSENT_REQUIRED);
    }

    @Test
    void 진행_중_복원_작업이_있으면_REC_002() {
        activeJobs(1);

        assertError(ReconstructionErrorCode.JOB_IN_PROGRESS);
    }

    @Test
    void 동의가_없으면_진행_중_작업보다_먼저_CAP_001() {
        faceDataAgreed(false);
        activeJobs(1);

        assertError(CaptureErrorCode.FACE_DATA_CONSENT_REQUIRED);
    }

    @Test
    void 없는_회원이면_AUTH_001() {
        when(userRepository.findById(USER_ID)).thenReturn(Optional.empty());

        assertError(AuthErrorCode.UNAUTHORIZED);
    }

    private void faceDataAgreed(boolean agreed) {
        UserConsent consent = mock(UserConsent.class);
        when(consent.isAgreed()).thenReturn(agreed);
        when(consentRepository.findFirstByUser_IdAndConsentTypeOrderByActedAtDesc(
                        USER_ID, ConsentType.FACE_DATA))
                .thenReturn(Optional.of(consent));
    }

    private void activeJobs(int count) {
        when(jdbcTemplate.queryForObject(anyString(), eq(Integer.class), eq(USER_ID)))
                .thenReturn(count);
    }

    private void assertError(ErrorCode code) {
        assertThatThrownBy(() -> guard.requireReady(USER_ID))
                .isInstanceOfSatisfying(
                        BusinessException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
    }
}
