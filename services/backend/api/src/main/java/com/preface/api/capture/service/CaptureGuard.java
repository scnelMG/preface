package com.preface.api.capture.service;

import com.preface.common.consent.entity.ConsentType;
import com.preface.common.consent.entity.UserConsent;
import com.preface.common.consent.repository.UserConsentRepository;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CaptureErrorCode;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 촬영 시작 전 공통 검사(API-CAP-01, API-QR-01). 순서: 활성 회원 → 얼굴 동의(CAP_001) → 진행 중 복원 작업(REC_002).
 *
 * <p>진행 중 작업은 SQL로 센다. {@code reconstruction_job} 엔티티는 복원 스토리에서 만든다.
 */
@Component
@RequiredArgsConstructor
class CaptureGuard {

    private final UserRepository userRepository;
    private final UserConsentRepository userConsentRepository;
    private final JdbcTemplate jdbcTemplate;

    @Transactional(readOnly = true)
    User requireReady(String userId) {
        User user =
                userRepository
                        .findById(userId)
                        .filter(User::isActive)
                        .orElseThrow(() -> new BusinessException(AuthErrorCode.UNAUTHORIZED));
        boolean faceDataAgreed =
                userConsentRepository
                        .findFirstByUser_IdAndConsentTypeOrderByActedAtDesc(
                                userId, ConsentType.FACE_DATA)
                        .map(UserConsent::isAgreed)
                        .orElse(false);
        if (!faceDataAgreed) {
            throw new BusinessException(CaptureErrorCode.FACE_DATA_CONSENT_REQUIRED);
        }
        if (hasActiveReconstruction(userId)) {
            throw new BusinessException(ReconstructionErrorCode.JOB_IN_PROGRESS);
        }
        return user;
    }

    private boolean hasActiveReconstruction(String userId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        "select count(*) from reconstruction_job"
                                + " where user_id = ? and status in ('QUEUED', 'RUNNING')",
                        Integer.class,
                        userId);
        return count != null && count > 0;
    }
}
