package com.preface.common.error;

/**
 * 관리자 페이지(ADM, S15P31B204-651).
 *
 * <p>common에 두는 이유: 보안 필터(api의 global)가 권한 거절 응답에 쓴다. {@link AuthErrorCode}와 같은 이유다.
 */
public enum AdminErrorCode implements ErrorCode {
    /** 로그인은 했지만 관리자가 아니다. 로그인하지 않았으면 AUTH_001 */
    FORBIDDEN("ADM_001", 403, "관리자만 볼 수 있어요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    AdminErrorCode(String code, int httpStatus, String message) {
        this.code = code;
        this.httpStatus = httpStatus;
        this.message = message;
    }

    @Override
    public String code() {
        return code;
    }

    @Override
    public int httpStatus() {
        return httpStatus;
    }

    @Override
    public String message() {
        return message;
    }
}
