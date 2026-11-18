package com.preface.api.global.security;

import com.preface.common.error.AdminErrorCode;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.ErrorCode;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;

/**
 * 보안 필터 단계의 실패 응답. 컨트롤러 밖이라 {@code GlobalExceptionHandler}가 잡지 못해서 같은 형식을 여기서 직접 쓴다.
 *
 * <ul>
 *   <li>인증 없음: 토큰 만료면 AUTH_002, 그 외(없음·위조) AUTH_001
 *   <li>권한 부족: 가입 토큰이면 AUTH_024, 업로드 전용 세션이면 AUTH_023, 관리자 API를 관리자가 아닌 회원이 부르면 ADM_001
 * </ul>
 */
public final class SecurityErrorResponses {

    private SecurityErrorResponses() {}

    public static AuthenticationEntryPoint entryPoint() {
        return (request, response, ex) -> {
            Object reason = request.getAttribute(JwtAuthenticationFilter.AUTH_ERROR_ATTRIBUTE);
            write(response, reason instanceof ErrorCode code ? code : AuthErrorCode.UNAUTHORIZED);
        };
    }

    public static AccessDeniedHandler accessDeniedHandler() {
        return (request, response, ex) -> {
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            ErrorCode code = AuthErrorCode.UNAUTHORIZED;
            if (authentication != null
                    && authentication.getPrincipal() instanceof AuthPrincipal principal) {
                code =
                        switch (principal.scope()) {
                            case SIGNUP -> AuthErrorCode.SIGNUP_REQUIRED;
                            case CAPTURE -> AuthErrorCode.CAPTURE_SCOPE_FORBIDDEN;
                            case USER ->
                                    request.getAttribute(AdminAuthorization.DENIED_ATTRIBUTE)
                                                    != null
                                            ? AdminErrorCode.FORBIDDEN
                                            : AuthErrorCode.UNAUTHORIZED;
                        };
            }
            write(response, code);
        };
    }

    private static void write(HttpServletResponse response, ErrorCode code) throws IOException {
        response.setStatus(code.httpStatus());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        // 코드·문구는 enum 상수(따옴표·역슬래시 없음)라 직렬화 라이브러리 없이 쓴다
        response.getWriter()
                .write(
                        "{\"success\":false,\"data\":null,\"error\":{\"code\":\""
                                + code.code()
                                + "\",\"message\":\""
                                + code.message()
                                + "\",\"details\":[]}}");
    }
}
