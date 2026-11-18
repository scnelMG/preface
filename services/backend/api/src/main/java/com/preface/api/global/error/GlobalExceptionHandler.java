package com.preface.api.global.error;

import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ErrorCode;
import com.preface.common.response.ApiResponse;
import com.preface.common.response.ErrorBody;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** 예외를 공통 응답 형식으로 바꾼다. 사용자에게는 코드와 고정 문구만 내보내고, 내부 사유는 로그에만 남긴다. */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException e) {
        log.info("business error: {}", e.getMessage());
        return toResponse(e.errorCode(), e.details());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException e) {
        List<ErrorBody.FieldError> details =
                e.getBindingResult().getFieldErrors().stream()
                        .map(f -> new ErrorBody.FieldError(f.getField(), f.getDefaultMessage()))
                        .toList();
        return toResponse(CommonErrorCode.INVALID_REQUEST, details);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<Void>> handleUnreadable(HttpMessageNotReadableException e) {
        return toResponse(CommonErrorCode.INVALID_REQUEST, List.of());
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiResponse<Void>> handleMissingParameter(
            MissingServletRequestParameterException e) {
        List<ErrorBody.FieldError> details =
                List.of(new ErrorBody.FieldError(e.getParameterName(), "필수 값이에요."));
        return toResponse(CommonErrorCode.INVALID_REQUEST, details);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleNoResource(NoResourceFoundException e) {
        return toResponse(CommonErrorCode.NOT_FOUND, List.of());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception e) {
        log.error("unexpected error", e);
        return toResponse(CommonErrorCode.INTERNAL_ERROR, List.of());
    }

    private ResponseEntity<ApiResponse<Void>> toResponse(
            ErrorCode code, List<ErrorBody.FieldError> details) {
        return ResponseEntity.status(code.httpStatus())
                .body(ApiResponse.fail(ErrorBody.of(code, details)));
    }
}
