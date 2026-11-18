package com.preface.api.global.security;

import com.preface.common.error.AuthErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * {@code Authorization: Bearer <JWT>}를 검증해 인증 정보를 채운다.
 *
 * <p>토큰이 틀려도 여기서 응답을 끊지 않는다. 인증 없이 부를 수 있는 API(로그인·동의서 조회 등)는 그대로 통과해야 하기 때문이다. 대신 실패 사유를 요청 속성에
 * 남기고, 인증이 필요한 API라면 {@link SecurityErrorResponses}가 그 사유로 AUTH_001·002를 고른다.
 *
 * <p>업로드 전용 세션({@code scope=capture})은 폐기 목록({@link CaptureSessionRevocations})도 본다. 폐기됐으면 인증하지 않고
 * AUTH_023을 사유로 남긴다.
 *
 * <p>회원 ID가 subject인 토큰(일반 세션·업로드 전용 세션)은 탈퇴 목록({@link WithdrawnUsers})도 본다. 탈퇴했으면 인증하지 않고
 * AUTH_001을 사유로 남긴다(API 명세서 "가입 가드": {@code status=WITHDRAWN} → AUTH_001).
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    static final String AUTH_ERROR_ATTRIBUTE = JwtAuthenticationFilter.class.getName() + ".error";
    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtProvider jwtProvider;
    private final CaptureSessionRevocations captureRevocations;
    private final WithdrawnUsers withdrawnUsers;

    public JwtAuthenticationFilter(
            JwtProvider jwtProvider,
            CaptureSessionRevocations captureRevocations,
            WithdrawnUsers withdrawnUsers) {
        this.jwtProvider = jwtProvider;
        this.captureRevocations = captureRevocations;
        this.withdrawnUsers = withdrawnUsers;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            authenticate(request, header.substring(BEARER_PREFIX.length()).trim());
        }
        chain.doFilter(request, response);
    }

    private void authenticate(HttpServletRequest request, String token) {
        try {
            AuthPrincipal principal = jwtProvider.parse(token);
            if (principal.scope() == TokenScope.CAPTURE
                    && captureRevocations.isRevoked(principal.captureLinkId())) {
                // PC가 끊은 휴대폰 세션. FE가 '휴대폰 연결 종료' 화면으로 가도록 AUTH_023을 준다
                request.setAttribute(AUTH_ERROR_ATTRIBUTE, AuthErrorCode.CAPTURE_SCOPE_FORBIDDEN);
                return;
            }
            if (principal.scope() != TokenScope.SIGNUP
                    && withdrawnUsers.contains(principal.subject())) {
                request.setAttribute(AUTH_ERROR_ATTRIBUTE, AuthErrorCode.UNAUTHORIZED);
                return;
            }
            var authentication =
                    new UsernamePasswordAuthenticationToken(
                            principal,
                            null,
                            List.of(new SimpleGrantedAuthority(principal.scope().authority())));
            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (JwtProvider.InvalidTokenException e) {
            request.setAttribute(
                    AUTH_ERROR_ATTRIBUTE,
                    e.expired() ? AuthErrorCode.ACCESS_TOKEN_EXPIRED : AuthErrorCode.UNAUTHORIZED);
        }
    }
}
