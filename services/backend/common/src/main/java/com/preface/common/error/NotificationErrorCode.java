package com.preface.common.error;

/**
 * Mattermost 완료 알림(S15P31B204-476) 에러. API 명세 가안 — 기획 문서 반영 전이다.
 *
 * <p>확인 코드를 너무 자주 다시 받으면 {@link CommonErrorCode#TOO_MANY_REQUESTS}를 쓴다.
 */
public enum NotificationErrorCode implements ErrorCode {
    MATTERMOST_DISABLED("NOTI_001", 503, "지금은 Mattermost 알림을 쓸 수 없어요."),
    MATTERMOST_USER_NOT_FOUND("NOTI_002", 400, "Mattermost 아이디를 찾을 수 없어요. 아이디를 다시 확인해 주세요."),
    VERIFICATION_CODE_MISMATCH("NOTI_003", 400, "확인 코드가 맞지 않아요."),
    VERIFICATION_EXPIRED("NOTI_004", 400, "확인 코드가 만료됐어요. 코드를 다시 받아 주세요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    NotificationErrorCode(String code, int httpStatus, String message) {
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
