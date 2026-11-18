package com.preface.api.share.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.regex.Pattern;

/**
 * 공유 링크 토큰. 32바이트 난수(256비트)라 추측할 수 없고, DB에는 SHA-256 해시만 둔다(DB가 새어도 링크를 만들 수 없다).
 *
 * <p>토큰 원문은 로그에 남기지 않는다.
 */
public final class ShareToken {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern FORMAT = Pattern.compile("^[A-Za-z0-9_-]{43}$");

    private ShareToken() {}

    /** base64url(패딩 없음) 43자. */
    public static String generate() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** SHA-256 → base64 44자({@code simulation_share.token_hash}). */
    public static String hash(String token) {
        try {
            byte[] digest =
                    MessageDigest.getInstance("SHA-256")
                            .digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** 길이·문자가 맞지 않는 값은 DB를 보지 않고 거른다. */
    public static boolean wellFormed(String token) {
        return token != null && FORMAT.matcher(token).matches();
    }
}
