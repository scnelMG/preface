package com.preface.api.auth.service;

import com.preface.api.auth.dto.AuthorizeUrlResponse;
import com.preface.api.auth.dto.IssuedSession;
import com.preface.api.auth.dto.LoginRequest;
import com.preface.api.auth.dto.LoginResponse;
import com.preface.api.auth.dto.LoginResult;
import com.preface.api.auth.dto.SignupProfile;
import com.preface.api.auth.service.oauth.OAuthClients;
import com.preface.api.auth.service.oauth.OAuthProfile;
import com.preface.api.auth.service.oauth.OAuthProviderClient;
import com.preface.api.global.security.AuthProperties;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenHashes;
import com.preface.api.global.security.TokenScope;
import com.preface.api.user.service.EmailMasker;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.user.entity.SocialAccount;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.SocialAccountRepository;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 소셜 로그인(API-AUTH-01·02).
 *
 * <p>흐름: FE가 인가 URL을 받아 사용자를 제공자로 보냄 → 제공자가 FE redirectUri로 code·state를 돌려줌 → FE가 그대로 이 API에 넘김 →
 * 서버가 client secret으로 code를 교환한다. secret은 서버에만 있다(FN-AUTH-01 수용 2).
 *
 * <p>로그인 전체를 트랜잭션으로 묶지 않는다. 제공자 HTTP 호출(최대 수 초) 동안 DB 커넥션을 붙잡지 않기 위해서다.
 */
@Service
@RequiredArgsConstructor
public class OAuthLoginService {

    private final OAuthClients clients;
    private final OAuthStateStore stateStore;
    private final SignupPendingStore pendingStore;
    private final SessionIssuer sessionIssuer;
    private final SocialAccountRepository socialAccountRepository;
    private final JwtProvider jwtProvider;
    private final AuthProperties properties;

    public AuthorizeUrlResponse authorizeUrl(String providerPath, String redirectUri) {
        OAuthProviderClient client = clients.get(providerPath);
        requireAllowed(redirectUri);
        String state = TokenHashes.newOpaqueToken();
        String url = client.authorizeUrl(redirectUri, state);
        stateStore.save(state, client.provider(), redirectUri);
        return new AuthorizeUrlResponse(url, state);
    }

    public LoginResult login(String providerPath, LoginRequest request) {
        OAuthProviderClient client = clients.get(providerPath);
        requireAllowed(request.redirectUri());
        if (!stateStore.consume(request.state(), client.provider(), request.redirectUri())) {
            throw new BusinessException(AuthErrorCode.STATE_MISMATCH);
        }
        OAuthProfile profile = client.fetchProfile(request.code(), request.redirectUri());

        Optional<SocialAccount> account =
                socialAccountRepository.findByProviderAndProviderUserId(
                        profile.provider(), profile.providerUserId());
        if (account.isPresent()) {
            User user = account.get().getUser();
            if (!user.isActive()) {
                throw new BusinessException(AuthErrorCode.UNAUTHORIZED, "withdrawn user login");
            }
            IssuedSession session = sessionIssuer.issue(user);
            return new LoginResult(
                    LoginResponse.existing(
                            session.accessToken(), session.expiresIn(), session.user()),
                    session.refreshToken());
        }

        // 신규: 회원 행을 만들지 않고 가입 토큰만 준다(REQ-F-01)
        String pendingId = UUID.randomUUID().toString();
        JwtProvider.IssuedToken signupToken =
                jwtProvider.issue(pendingId, TokenScope.SIGNUP, properties.signupTokenTtl());
        pendingStore.save(pendingId, profile, properties.signupTokenTtl());
        SignupProfile signupProfile =
                new SignupProfile(
                        profile.provider().name(),
                        profile.nickname(),
                        EmailMasker.mask(profile.email()));
        return new LoginResult(
                LoginResponse.newUser(
                        signupToken.value(), signupToken.expiresInSeconds(), signupProfile),
                null);
    }

    private void requireAllowed(String redirectUri) {
        if (!properties.allowedRedirectUris().contains(redirectUri)) {
            throw new BusinessException(AuthErrorCode.REDIRECT_URI_NOT_ALLOWED);
        }
    }
}
