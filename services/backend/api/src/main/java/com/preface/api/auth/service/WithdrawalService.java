package com.preface.api.auth.service;

import com.preface.api.deletion.service.FaceDataEraser;
import com.preface.api.global.security.WithdrawnUsers;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.SocialAccountRepository;
import com.preface.common.user.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 회원 탈퇴(API-AUTH-11, FN-AUTH-04). 유예 없는 하드 삭제.
 *
 * <p>한 트랜잭션: 회원 행 잠금 → 진행 중 복원 작업 CANCELED → 얼굴 관련 레코드 물리 삭제 + S3 객체마다 {@code data_deletion_log}
 * PENDING → 회원 개인정보 NULL·WITHDRAWN → 소셜 계정 삭제. 커밋 뒤 세션 폐기(refresh 전부 + access 거절 목록).
 *
 * <p>세션 폐기를 커밋 뒤에 하는 이유: 커밋 전에 하면 롤백됐을 때 탈퇴하지 않은 회원이 로그아웃된다. 반대로 커밋 뒤 Redis가 실패해도 재발급(AUTH-03)이 탈퇴
 * 회원을 AUTH_003으로 막으므로 새 세션은 생기지 않는다.
 *
 * <p>동의 기록({@code user_consent})은 지우지 않는다. 동의·철회 증빙이라 법정 보관 대상으로 분리한다(FN-AUTH-04 "법정 보관 필요 항목은 별도
 * 분리"). 회원 행이 식별자만 남는 것도 이 기록과 삭제 기록을 잇기 위해서다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WithdrawalService {

    private final UserRepository userRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final FaceDataEraser faceDataEraser;
    private final RefreshTokenStore refreshTokenStore;
    private final WithdrawnUsers withdrawnUsers;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    public void withdraw(String userId) {
        transactionTemplate.executeWithoutResult(status -> erase(userId, clock.instant()));
        withdrawnUsers.add(userId);
        refreshTokenStore.revokeAll(userId);
        log.info("user withdrawn: userId={}", userId);
    }

    private void erase(String userId, Instant now) {
        // 복원 작업 생성(FaceUploadGateway.lockUser)과 같은 행을 잠가, 탈퇴 도중 새 작업이 생기지 않게 한다
        User user =
                userRepository
                        .findByIdForUpdate(userId)
                        .filter(User::isActive)
                        .orElseThrow(() -> new BusinessException(AuthErrorCode.UNAUTHORIZED));
        faceDataEraser.eraseAllForWithdrawal(userId, now);
        user.withdraw(now);
        socialAccountRepository.deleteAllByUserId(userId);
    }
}
