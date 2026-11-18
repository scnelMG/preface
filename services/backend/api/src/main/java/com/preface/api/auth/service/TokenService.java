package com.preface.api.auth.service;

import com.preface.api.auth.dto.IssuedSession;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 토큰 재발급(API-AUTH-03)·로그아웃(API-AUTH-04). */
@Service
@RequiredArgsConstructor
public class TokenService {

    private final RefreshTokenStore refreshTokenStore;
    private final SessionIssuer sessionIssuer;
    private final UserRepository userRepository;

    /** refresh를 소모하고 새 access·refresh를 준다(회전). 없음·만료·이미 쓴 refresh·탈퇴 회원이면 AUTH_003. */
    public IssuedSession refresh(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new BusinessException(AuthErrorCode.REFRESH_TOKEN_INVALID);
        }
        String userId =
                refreshTokenStore
                        .consume(refreshToken)
                        .orElseThrow(
                                () -> new BusinessException(AuthErrorCode.REFRESH_TOKEN_INVALID));
        User user =
                userRepository
                        .findById(userId)
                        .filter(User::isActive)
                        .orElseThrow(
                                () -> new BusinessException(AuthErrorCode.REFRESH_TOKEN_INVALID));
        return sessionIssuer.issue(user);
    }

    public void logout(String refreshToken) {
        if (refreshToken != null && !refreshToken.isBlank()) {
            refreshTokenStore.revoke(refreshToken);
        }
    }
}
