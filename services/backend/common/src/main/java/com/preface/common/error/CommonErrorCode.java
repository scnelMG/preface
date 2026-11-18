package com.preface.common.error;

/** 모든 영역이 함께 쓰는 에러. API 명세서 v2.7 "공통 에러". */
public enum CommonErrorCode implements ErrorCode {
    INVALID_REQUEST("COMMON_001", 400, "요청 값을 확인해 주세요."),
    NOT_FOUND("COMMON_002", 404, "요청한 정보를 찾을 수 없어요."),
    TOO_MANY_REQUESTS("COMMON_003", 429, "잠시 후 다시 시도해 주세요."),
    INTERNAL_ERROR("COMMON_999", 500, "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    CommonErrorCode(String code, int httpStatus, String message) {
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
