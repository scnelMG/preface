package com.preface.common.error;

/** 상담(CON) 에러. API 명세서 v2.9 "8. 에러 코드 전체". AI 장애는 CON_002(시간 초과)·CON_003(그 밖)으로 모은다. */
public enum ConsultErrorCode implements ErrorCode {
    INVALID_MESSAGE("CON_001", 400, "메시지는 1~300자로 보내 주세요."),
    AI_TIMEOUT("CON_002", 504, "AI 실장님 답변이 늦어지고 있어요. 얼굴은 바꾸지 않았어요. 잠시 후 다시 시도해 주세요."),
    AI_UNAVAILABLE("CON_003", 502, "AI 실장님이 지금 답할 수 없어요. 얼굴은 바꾸지 않았어요. 잠시 후 다시 시도해 주세요."),
    NOT_APPLICABLE("CON_010", 409, "이 요청은 지금 반영할 수 없어요. 다시 요청해 주세요."),
    DUPLICATE_REQUEST("CON_011", 409, "같은 상담 요청이 이미 처리 중이거나 처리됐어요. 대화 내역을 확인해 주세요. 얼굴은 바꾸지 않았어요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    ConsultErrorCode(String code, int httpStatus, String message) {
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
