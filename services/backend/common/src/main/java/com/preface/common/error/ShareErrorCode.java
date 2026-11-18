package com.preface.common.error;

/** 시안 공유(SHR, S15P31B204-574). 설계 docs/design/simulation-share.md 2절. */
public enum ShareErrorCode implements ErrorCode {
    /** 없음·끝남·만료·삭제·탈퇴·동의 철회를 구분하지 않는다(링크가 있었는지 추측하지 못하게). */
    LINK_UNAVAILABLE("SHR_001", 404, "링크가 만료되었거나 공유가 끝났어요"),
    EMPTY_SIMULATION("SHR_002", 409, "변경한 뒤 공유할 수 있어요"),
    CONSENT_REQUIRED("SHR_003", 409, "공유하려면 얼굴 데이터 공개 동의가 필요해요");

    private final String code;
    private final int httpStatus;
    private final String message;

    ShareErrorCode(String code, int httpStatus, String message) {
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
