package com.preface.api.global.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 내부 API({@code /internal/**})의 공유 시크릿 인증. 헤더 {@code X-Internal-Secret}이 설정값과 같으면 {@link
 * #AUTHORITY}를 준다.
 *
 * <p>비교는 두 값의 SHA-256을 {@link MessageDigest#isEqual}로 한다. 길이가 같은 값끼리 상수 시간으로 비교되므로 응답 시간으로 시크릿 길이나
 * 앞부분을 추측할 수 없다.
 *
 * <p>시크릿이 설정되지 않았으면 모든 요청을 거절한다(fail-closed). 헤더 값은 로그에 남기지 않는다.
 */
public class InternalSecretFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Internal-Secret";
    public static final String AUTHORITY = "INTERNAL_WORKER";
    private static final int MIN_SECRET_BYTES = 32;

    private final byte[] expectedDigest;

    public InternalSecretFilter(String secret) {
        if (secret == null || secret.isBlank()) {
            this.expectedDigest = null;
            return;
        }
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException(
                    "preface.internal.secret(INTERNAL_API_SECRET) must be at least 32 bytes");
        }
        this.expectedDigest = sha256(bytes);
    }

    public boolean configured() {
        return expectedDigest != null;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (matches(request.getHeader(HEADER))) {
            var authentication =
                    new UsernamePasswordAuthenticationToken(
                            "internal-worker",
                            null,
                            List.of(new SimpleGrantedAuthority(AUTHORITY)));
            SecurityContextHolder.getContext().setAuthentication(authentication);
        }
        chain.doFilter(request, response);
    }

    boolean matches(String provided) {
        if (expectedDigest == null || provided == null) {
            return false;
        }
        return MessageDigest.isEqual(
                expectedDigest, sha256(provided.getBytes(StandardCharsets.UTF_8)));
    }

    private static byte[] sha256(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
