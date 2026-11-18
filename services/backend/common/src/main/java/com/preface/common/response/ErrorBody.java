package com.preface.common.response;

import com.preface.common.error.ErrorCode;
import java.util.List;

/** 실패 응답의 {@code error} 필드. {@code details}는 검증 실패(COMMON_001)일 때 필드별 사유를 담는다. */
public record ErrorBody(String code, String message, List<FieldError> details) {

    public static ErrorBody of(ErrorCode errorCode) {
        return new ErrorBody(errorCode.code(), errorCode.message(), List.of());
    }

    public static ErrorBody of(ErrorCode errorCode, List<FieldError> details) {
        return new ErrorBody(errorCode.code(), errorCode.message(), List.copyOf(details));
    }

    public record FieldError(String field, String reason) {}
}
