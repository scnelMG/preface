package com.preface.common.error;

/**
 * AI 관상(재미용, S15P31B204-438) 에러. API 명세 가안 — 기획 문서 반영 전이다.
 *
 * <p>GMS 장애·시간 초과는 요청 응답이 아니라 관상 상태(FAILED)로 알린다(비동기라서).
 */
public enum FaceReadingErrorCode implements ErrorCode {
    PHOTO_NOT_READY("READ_001", 409, "아직 얼굴 사진을 고르는 중이에요. 잠시 후 다시 눌러 주세요."),
    PHOTO_GONE("READ_002", 409, "3D가 이미 완성돼 관상에 쓸 사진이 없어요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    FaceReadingErrorCode(String code, int httpStatus, String message) {
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
