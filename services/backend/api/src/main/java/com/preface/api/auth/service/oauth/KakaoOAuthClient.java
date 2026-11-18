package com.preface.api.auth.service.oauth;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.preface.api.global.security.AuthProperties;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.user.entity.OAuthProvider;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

/** 카카오 로그인(REST API). 문서: developers.kakao.com 카카오 로그인 REST API. */
@Component
public class KakaoOAuthClient implements OAuthProviderClient {

    private static final String AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize";
    private static final String TOKEN_URL = "https://kauth.kakao.com/oauth/token";
    private static final String USER_URL = "https://kapi.kakao.com/v2/user/me";

    private final AuthProperties.Provider config;
    private final RestClient restClient;

    public KakaoOAuthClient(AuthProperties properties, RestClient.Builder builder) {
        this.config = properties.kakao();
        this.restClient = OAuthHttp.restClient(builder);
    }

    @Override
    public OAuthProvider provider() {
        return OAuthProvider.KAKAO;
    }

    @Override
    public String authorizeUrl(String redirectUri, String state) {
        requireConfigured();
        return UriComponentsBuilder.fromUriString(AUTHORIZE_URL)
                .queryParam("response_type", "code")
                .queryParam("client_id", config.clientId())
                .queryParam("redirect_uri", redirectUri)
                .queryParam("state", state)
                .encode()
                .toUriString();
    }

    @Override
    public OAuthProfile fetchProfile(String code, String redirectUri) {
        requireConfigured();
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", config.clientId());
        form.add("client_secret", config.clientSecret());
        form.add("redirect_uri", redirectUri);
        form.add("code", code);
        try {
            TokenResponse token =
                    restClient
                            .post()
                            .uri(TOKEN_URL)
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .body(form)
                            .retrieve()
                            .body(TokenResponse.class);
            if (token == null || token.accessToken() == null) {
                throw new BusinessException(AuthErrorCode.PROVIDER_ERROR, "kakao empty token");
            }
            UserResponse user =
                    restClient
                            .get()
                            .uri(USER_URL)
                            .headers(h -> h.setBearerAuth(token.accessToken()))
                            .retrieve()
                            .body(UserResponse.class);
            if (user == null || user.id() == null) {
                throw new BusinessException(AuthErrorCode.PROVIDER_ERROR, "kakao empty user");
            }
            KakaoAccount account = user.kakaoAccount();
            String nickname =
                    account == null || account.profile() == null
                            ? null
                            : account.profile().nickname();
            String email = account == null ? null : account.email();
            return new OAuthProfile(
                    OAuthProvider.KAKAO, String.valueOf(user.id()), nickname, email);
        } catch (RestClientException e) {
            // 응답 본문에 토큰이 들어 있을 수 있어 예외 메시지(본문)는 남기지 않는다
            throw new BusinessException(
                    AuthErrorCode.PROVIDER_ERROR, "kakao " + e.getClass().getSimpleName());
        }
    }

    private void requireConfigured() {
        if (!config.configured()) {
            throw new BusinessException(
                    AuthErrorCode.PROVIDER_ERROR, "kakao client not configured");
        }
    }

    record TokenResponse(@JsonProperty("access_token") String accessToken) {}

    record UserResponse(Long id, @JsonProperty("kakao_account") KakaoAccount kakaoAccount) {}

    record KakaoAccount(Profile profile, String email) {}

    record Profile(String nickname) {}
}
