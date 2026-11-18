package com.preface.common.error;

/** 시안·이력(HIS) 에러. API 명세서 v2.7 "8. 에러 코드 전체". */
public enum HistoryErrorCode implements ErrorCode {
    BEING_DELETED("HIS_002", 409, "삭제 중인 항목이에요."),
    /** 내 머리 썸네일 올리기(S15P31B204-436, 가안). 이미 썸네일이 있으면 다시 올리지 않는다. */
    THUMBNAIL_EXISTS("HIS_010", 409, "이미 썸네일이 있어요."),
    /** 썸네일 저장 확인 때 S3에 올라온 파일이 없거나 크기·체크섬이 다르다(가안). */
    THUMBNAIL_NOT_UPLOADED("HIS_011", 409, "썸네일이 올라오지 않았어요. 다시 시도해 주세요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    HistoryErrorCode(String code, int httpStatus, String message) {
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
