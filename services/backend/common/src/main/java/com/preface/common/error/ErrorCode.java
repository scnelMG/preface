package com.preface.common.error;

/**
 * 에러 코드. 접두사는 기능 영역이다(COMMON, AUTH, CAP, QR, REC, EDIT, CON, HIS, NOTI, ADM).
 *
 * <p>영역마다 이 인터페이스를 구현한 enum을 하나씩 둔다(예: {@code AuthErrorCode}). 코드·HTTP 상태·문구의 원본은 API 명세서 v2.7 "8.
 * 에러 코드 전체"다.
 */
public interface ErrorCode {

    String code();

    int httpStatus();

    String message();
}
