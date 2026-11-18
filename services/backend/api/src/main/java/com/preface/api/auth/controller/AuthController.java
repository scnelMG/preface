package com.preface.api.auth.controller;

import com.preface.api.auth.dto.AuthorizeUrlResponse;
import com.preface.api.auth.dto.IssuedSession;
import com.preface.api.auth.dto.LoginRequest;
import com.preface.api.auth.dto.LoginResponse;
import com.preface.api.auth.dto.LoginResult;
import com.preface.api.auth.dto.SessionResponse;
import com.preface.api.auth.dto.SignupRequest;
import com.preface.api.auth.dto.TokenResponse;
import com.preface.api.auth.service.OAuthLoginService;
import com.preface.api.auth.service.SignupService;
import com.preface.api.auth.service.TokenService;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.common.response.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 인증 API(API-AUTH-01~04, 08). refresh token은 본문에 넣지 않고 쿠키로만 주고받는다. */
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final OAuthLoginService oAuthLoginService;
    private final SignupService signupService;
    private final TokenService tokenService;
    private final RefreshCookies refreshCookies;

    /** API-AUTH-01 */
    @GetMapping("/oauth/{provider}/authorize-url")
    public ApiResponse<AuthorizeUrlResponse> authorizeUrl(
            @PathVariable String provider, @RequestParam String redirectUri) {
        return ApiResponse.ok(oAuthLoginService.authorizeUrl(provider, redirectUri));
    }

    /** API-AUTH-02 */
    @PostMapping("/oauth/{provider}/login")
    public ResponseEntity<ApiResponse<LoginResponse>> login(
            @PathVariable String provider, @Valid @RequestBody LoginRequest request) {
        LoginResult result = oAuthLoginService.login(provider, request);
        ResponseEntity.BodyBuilder response = ResponseEntity.ok();
        if (result.refreshToken() != null) {
            response.header(
                    HttpHeaders.SET_COOKIE, refreshCookies.issue(result.refreshToken()).toString());
        }
        return response.body(ApiResponse.ok(result.body()));
    }

    /** API-AUTH-03 */
    @PostMapping("/token/refresh")
    public ResponseEntity<ApiResponse<TokenResponse>> refresh(HttpServletRequest request) {
        IssuedSession session = tokenService.refresh(refreshCookies.read(request));
        return ResponseEntity.ok()
                .header(
                        HttpHeaders.SET_COOKIE,
                        refreshCookies.issue(session.refreshToken()).toString())
                .body(
                        ApiResponse.ok(
                                new TokenResponse(session.accessToken(), session.expiresIn())));
    }

    /** API-AUTH-04 */
    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Map<String, Object>>> logout(HttpServletRequest request) {
        tokenService.logout(refreshCookies.read(request));
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshCookies.expire().toString())
                .body(ApiResponse.ok(Map.of()));
    }

    /** API-AUTH-08. 인증은 가입 토큰(Authorization: Bearer)이고 서비스가 직접 검사한다. */
    @PostMapping("/signup")
    public ResponseEntity<ApiResponse<SessionResponse>> signup(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody SignupRequest request) {
        IssuedSession session = signupService.signup(principal, request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .header(
                        HttpHeaders.SET_COOKIE,
                        refreshCookies.issue(session.refreshToken()).toString())
                .body(
                        ApiResponse.ok(
                                new SessionResponse(
                                        session.accessToken(),
                                        session.expiresIn(),
                                        session.user())));
    }
}
