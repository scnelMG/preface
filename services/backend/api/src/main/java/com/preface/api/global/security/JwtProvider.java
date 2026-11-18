package com.preface.api.global.security;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Component;

/**
 * access·가입 토큰(JWT, HS256) 발급과 검증.
 *
 * <p>만료 검사는 Nimbus 기본 검증기 대신 직접 한다. 만료(AUTH_002, FE가 재발급 후 재시도)와 위조·형식 오류(AUTH_001, 재로그인)를 다른 코드로
 * 돌려줘야 하기 때문이다. 기본 검증기는 둘 다 같은 예외로 던진다.
 */
@Component
public class JwtProvider {

    private static final String ISSUER = "preface";
    private static final String SCOPE_CLAIM = "scope";
    private static final String CAPTURE_LINK_CLAIM = "cid";
    private static final int MIN_SECRET_BYTES = 32;

    private final NimbusJwtEncoder encoder;
    private final NimbusJwtDecoder decoder;
    private final Clock clock;

    public JwtProvider(AuthProperties properties, Clock clock) {
        SecretKey key = secretKey(properties.jwtSecret());
        this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        this.decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        this.decoder.setJwtValidator(new JwtIssuerValidator(ISSUER));
        this.clock = clock;
    }

    public IssuedToken issue(String subject, TokenScope scope, Duration ttl) {
        return encode(claims(subject, scope, ttl).build(), ttl);
    }

    /** 업로드 전용 세션({@code scope=capture}). 폐기 확인용으로 QR 링크 ID를 {@code cid} 클레임에 넣는다. */
    public IssuedToken issueCapture(String userId, String linkId, Duration ttl) {
        return encode(
                claims(userId, TokenScope.CAPTURE, ttl).claim(CAPTURE_LINK_CLAIM, linkId).build(),
                ttl);
    }

    private JwtClaimsSet.Builder claims(String subject, TokenScope scope, Duration ttl) {
        Instant now = clock.instant();
        return JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(subject)
                .id(UUID.randomUUID().toString())
                .issuedAt(now)
                .expiresAt(now.plus(ttl))
                .claim(SCOPE_CLAIM, scope.value());
    }

    private IssuedToken encode(JwtClaimsSet claims, Duration ttl) {
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        String token = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new IssuedToken(token, ttl.toSeconds());
    }

    /**
     * @throws InvalidTokenException 서명·형식·발급자·scope가 틀리거나 만료됨({@link
     *     InvalidTokenException#expired()}로 구분)
     */
    public AuthPrincipal parse(String token) {
        Jwt jwt;
        try {
            jwt = decoder.decode(token);
        } catch (JwtException e) {
            throw new InvalidTokenException(false);
        }
        Instant expiresAt = jwt.getExpiresAt();
        if (expiresAt == null || !clock.instant().isBefore(expiresAt)) {
            throw new InvalidTokenException(true);
        }
        TokenScope scope =
                TokenScope.from(jwt.getClaimAsString(SCOPE_CLAIM))
                        .orElseThrow(() -> new InvalidTokenException(false));
        if (scope != TokenScope.CAPTURE) {
            return new AuthPrincipal(jwt.getSubject(), scope);
        }
        String linkId = jwt.getClaimAsString(CAPTURE_LINK_CLAIM);
        if (linkId == null || linkId.isBlank()) {
            throw new InvalidTokenException(false);
        }
        return new AuthPrincipal(jwt.getSubject(), scope, linkId);
    }

    private static SecretKey secretKey(String secret) {
        byte[] bytes = secret == null ? new byte[0] : secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException(
                    "preface.auth.jwt-secret(JWT_SECRET) must be at least 32 bytes");
        }
        return new SecretKeySpec(bytes, "HmacSHA256");
    }

    public record IssuedToken(String value, long expiresInSeconds) {}

    public static class InvalidTokenException extends RuntimeException {

        private final boolean expired;

        InvalidTokenException(boolean expired) {
            super(expired ? "token expired" : "token invalid");
            this.expired = expired;
        }

        public boolean expired() {
            return expired;
        }
    }
}
