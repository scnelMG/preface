package com.preface.common.error;

import com.preface.common.response.ErrorBody;
import java.util.List;

/**
 * 비즈니스 규칙 위반. 서비스 계층에서 던지고 api의 {@code GlobalExceptionHandler}가 공통 응답으로 바꾼다.
 *
 * <p>타인 리소스 접근은 존재 여부를 숨기려고 {@link CommonErrorCode#NOT_FOUND}(404)로 던진다(API 명세서 "권한").
 */
public class BusinessException extends RuntimeException {

    private final transient ErrorCode errorCode;
    private final transient List<ErrorBody.FieldError> details;

    public BusinessException(ErrorCode errorCode) {
        super(errorCode.code() + ": " + errorCode.message());
        this.errorCode = errorCode;
        this.details = List.of();
    }

    public BusinessException(ErrorCode errorCode, String internalDetail) {
        super(errorCode.code() + ": " + internalDetail);
        this.errorCode = errorCode;
        this.details = List.of();
    }

    /** 응답 {@code error.details[]}에 사유를 함께 내보낼 때(예: CAP_002 정책 위반 항목). 사용자에게 보여도 되는 값만 넣는다. */
    public BusinessException(ErrorCode errorCode, List<ErrorBody.FieldError> details) {
        super(errorCode.code() + ": " + errorCode.message());
        this.errorCode = errorCode;
        this.details = List.copyOf(details);
    }

    public ErrorCode errorCode() {
        return errorCode;
    }

    public List<ErrorBody.FieldError> details() {
        return details;
    }
}
