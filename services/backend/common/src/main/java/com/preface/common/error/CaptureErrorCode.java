package com.preface.common.error;

/**
 * 업로드(CAP)·QR 휴대폰 연결(QR) 에러. API 명세서 v2.7 "8. 에러 코드 전체".
 *
 * <p>업로드·QR 사전 조건인 "진행 중 작업 있음"(REC_002)은 {@link ReconstructionErrorCode#JOB_IN_PROGRESS}를 쓴다.
 */
public enum CaptureErrorCode implements ErrorCode {
    FACE_DATA_CONSENT_REQUIRED("CAP_001", 403, "얼굴 데이터 이용에 동의해야 촬영할 수 있어요."),
    UPLOAD_POLICY_VIOLATION("CAP_002", 400, "영상 형식·크기·길이를 확인해 주세요."),
    UPLOAD_OBJECT_MISSING("CAP_003", 409, "올린 영상을 찾지 못했어요. 다시 올려 주세요."),
    UPLOAD_EXPIRED("CAP_004", 410, "업로드 시간이 지났어요. 다시 올려 주세요."),
    UPLOAD_CHECKSUM_MISMATCH("CAP_005", 409, "영상이 제대로 올라가지 않았어요. 다시 올려 주세요."),
    LINK_EXPIRED("QR_001", 410, "QR 코드가 만료됐어요. PC에서 새 QR을 만들어 주세요."),
    LINK_ALREADY_CONNECTED("QR_002", 409, "이미 다른 기기와 연결된 QR 코드예요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    CaptureErrorCode(String code, int httpStatus, String message) {
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
