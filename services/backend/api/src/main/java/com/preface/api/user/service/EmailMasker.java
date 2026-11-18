package com.preface.api.user.service;

/**
 * 이메일 마스킹: {@code minseo@kakao.com} → {@code m***@kakao.com}. 원문 이메일은 응답으로 내리지 않는다(API-AUTH-05).
 */
public final class EmailMasker {

    private EmailMasker() {}

    public static String mask(String email) {
        if (email == null) {
            return null;
        }
        int at = email.indexOf('@');
        if (at <= 0) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }
}
