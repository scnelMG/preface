package com.preface.api.auth.service;

import com.preface.api.auth.dto.IssuedSession;
import com.preface.api.auth.dto.SignupRequest;
import com.preface.api.auth.service.oauth.OAuthProfile;
import com.preface.api.consent.service.ConsentDocumentService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.api.global.security.TokenScope;
import com.preface.common.consent.entity.ConsentDocument;
import com.preface.common.consent.entity.ConsentType;
import com.preface.common.consent.entity.UserConsent;
import com.preface.common.consent.repository.UserConsentRepository;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.user.entity.SocialAccount;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.SocialAccountRepository;
import com.preface.common.user.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 가입 완료(API-AUTH-08). 회원·소셜 계정·동의 4행을 한 트랜잭션으로 만든다. 하나라도 실패하면 아무것도 남지 않는다(FN-AUTH-05 수용 1·5).
 *
 * <p>세션은 커밋이 끝난 뒤 발급한다. 커밋 전에 발급하면 롤백됐을 때 없는 회원의 토큰이 남는다. 그래서 {@code @Transactional} 대신 {@link
 * TransactionTemplate}으로 트랜잭션 경계를 메서드 안에서 직접 정한다.
 */
@Service
@RequiredArgsConstructor
public class SignupService {

    private final SignupPendingStore pendingStore;
    private final SessionIssuer sessionIssuer;
    private final ConsentDocumentService consentDocumentService;
    private final UserRepository userRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final UserConsentRepository userConsentRepository;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    public IssuedSession signup(AuthPrincipal principal, SignupRequest request) {
        if (principal == null || principal.scope() != TokenScope.SIGNUP) {
            throw new BusinessException(AuthErrorCode.SIGNUP_TOKEN_INVALID);
        }
        String pendingId = principal.subject();
        SignupPendingStore.Pending pending =
                pendingStore
                        .find(pendingId)
                        .orElseThrow(
                                () -> new BusinessException(AuthErrorCode.SIGNUP_TOKEN_INVALID));

        // 같은 가입 토큰으로 재시도: 이미 만든 회원의 세션을 돌려준다(멱등)
        if (pending.completedUserId() != null) {
            return sessionIssuer.issue(activeUser(pending.completedUserId()));
        }

        User user;
        try {
            user = transactionTemplate.execute(status -> createMember(pending.profile(), request));
        } catch (DataIntegrityViolationException e) {
            // 동시에 두 번 제출해 uk_social_provider_user에 걸림 → 먼저 끝난 쪽 회원을 쓴다
            user = existingMember(pending.profile());
        }
        pendingStore.markCompleted(pendingId, user.getId());
        return sessionIssuer.issue(user);
    }

    private User createMember(OAuthProfile profile, SignupRequest request) {
        Map<ConsentType, ConsentDocument> current = consentDocumentService.currentByType();
        ConsentSubmission.validate(request.consents(), current);

        Optional<SocialAccount> existing =
                socialAccountRepository.findByProviderAndProviderUserId(
                        profile.provider(), profile.providerUserId());
        if (existing.isPresent()) {
            return existing.get().getUser();
        }
        User user = userRepository.save(User.join(profile.nickname(), profile.email()));
        socialAccountRepository.saveAndFlush(
                SocialAccount.link(user, profile.provider(), profile.providerUserId()));
        Instant now = clock.instant();
        for (ConsentDocument document : current.values()) {
            userConsentRepository.save(UserConsent.agree(user, document, now));
        }
        return user;
    }

    private User existingMember(OAuthProfile profile) {
        return socialAccountRepository
                .findByProviderAndProviderUserId(profile.provider(), profile.providerUserId())
                .map(SocialAccount::getUser)
                .orElseThrow(() -> new IllegalStateException("signup conflict without account"));
    }

    private User activeUser(String userId) {
        return userRepository
                .findById(userId)
                .filter(User::isActive)
                .orElseThrow(() -> new BusinessException(AuthErrorCode.SIGNUP_TOKEN_INVALID));
    }
}
