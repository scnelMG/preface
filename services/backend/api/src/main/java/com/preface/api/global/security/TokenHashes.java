package com.preface.api.global.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * 불투명 토큰(refresh, state) 생성과 저장용 해시.
 *
 * <p>Redis 키에 토큰 원문 대신 SHA-256을 쓴다. Redis가 노출돼도 키만으로는 토큰을 쓸 수 없다.
 */
public final class TokenHashes {

    private static final SecureRandom RANDOM = new SecureRandom();

    private TokenHashes() {}

    /** 256비트 난수, URL-safe Base64(패딩 없음). */
    public static String newOpaqueToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
