package com.preface.common.error;

/**
 * 인증·회원·동의(AUTH) 에러. API 명세서 v2.7 "8. 에러 코드 전체".
 *
 * <p>common에 두는 이유: 보안 필터(api의 global)와 인증 서비스(api의 auth)가 함께 쓴다. api 안의 한 도메인에 두면 global → 도메인 의존이
 * 생겨 순환 의존 규칙(ArchitectureTest)에 걸린다.
 */
public enum AuthErrorCode implements ErrorCode {
    UNAUTHORIZED("AUTH_001", 401, "로그인이 필요해요."),
    ACCESS_TOKEN_EXPIRED("AUTH_002", 401, "로그인이 만료됐어요."),
    REFRESH_TOKEN_INVALID("AUTH_003", 401, "다시 로그인해 주세요."),
    UNSUPPORTED_PROVIDER("AUTH_010", 400, "지원하지 않는 로그인 방식이에요."),
    REDIRECT_URI_NOT_ALLOWED("AUTH_011", 400, "허용되지 않은 주소예요."),
    STATE_MISMATCH("AUTH_012", 400, "로그인 요청이 만료됐어요. 다시 시도해 주세요."),
    PROVIDER_ERROR("AUTH_013", 502, "로그인 서비스와 연결하지 못했어요. 잠시 후 다시 시도해 주세요."),
    CAPTURE_SCOPE_FORBIDDEN("AUTH_023", 403, "휴대폰 연결에서는 사용할 수 없는 기능이에요."),
    SIGNUP_REQUIRED("AUTH_024", 403, "가입을 먼저 완료해 주세요."),
    CONSENT_OUTDATED("AUTH_030", 400, "동의 내용이 바뀌었어요. 다시 확인해 주세요."),
    CONSENT_INCOMPLETE("AUTH_031", 400, "필수 항목에 모두 동의해 주세요."),
    SIGNUP_TOKEN_INVALID("AUTH_032", 401, "가입 시간이 지났어요. 다시 로그인해 주세요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    AuthErrorCode(String code, int httpStatus, String message) {
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
