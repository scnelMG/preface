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

/** 구글 OAuth 2.0(OpenID Connect). scope는 openid·email·profile만 쓴다. */
@Component
public class GoogleOAuthClient implements OAuthProviderClient {

    private static final String AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String USER_URL = "https://openidconnect.googleapis.com/v1/userinfo";

    private final AuthProperties.Provider config;
    private final RestClient restClient;

    public GoogleOAuthClient(AuthProperties properties, RestClient.Builder builder) {
        this.config = properties.google();
        this.restClient = OAuthHttp.restClient(builder);
    }

    @Override
    public OAuthProvider provider() {
        return OAuthProvider.GOOGLE;
    }

    @Override
    public String authorizeUrl(String redirectUri, String state) {
        requireConfigured();
        return UriComponentsBuilder.fromUriString(AUTHORIZE_URL)
                .queryParam("response_type", "code")
                .queryParam("client_id", config.clientId())
                .queryParam("redirect_uri", redirectUri)
                .queryParam("scope", "openid email profile")
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
                throw new BusinessException(AuthErrorCode.PROVIDER_ERROR, "google empty token");
            }
            UserInfo user =
                    restClient
                            .get()
                            .uri(USER_URL)
                            .headers(h -> h.setBearerAuth(token.accessToken()))
                            .retrieve()
                            .body(UserInfo.class);
            if (user == null || user.sub() == null) {
                throw new BusinessException(AuthErrorCode.PROVIDER_ERROR, "google empty user");
            }
            return new OAuthProfile(OAuthProvider.GOOGLE, user.sub(), user.name(), user.email());
        } catch (RestClientException e) {
            throw new BusinessException(
                    AuthErrorCode.PROVIDER_ERROR, "google " + e.getClass().getSimpleName());
        }
    }

    private void requireConfigured() {
        if (!config.configured()) {
            throw new BusinessException(
                    AuthErrorCode.PROVIDER_ERROR, "google client not configured");
        }
    }

    record TokenResponse(@JsonProperty("access_token") String accessToken) {}

    record UserInfo(String sub, String name, String email) {}
}
