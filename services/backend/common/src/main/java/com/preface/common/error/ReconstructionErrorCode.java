package com.preface.common.error;

/**
 * 3D 복원(REC) 에러. API 명세서 v2.7 "8. 에러 코드 전체".
 *
 * <p>REC_021·REC_022·REC_023은 워커 pull 방식 계약({@code contracts/reconstruction})에서 추가한 [제안] 코드다(내부 API
 * 전용). 명세에 반영해야 한다.
 */
public enum ReconstructionErrorCode implements ErrorCode {
    JOB_IN_PROGRESS("REC_002", 409, "이미 진행 중인 3D 생성 작업이 있어요."),
    JOB_CANCELED("REC_020", 409, "취소된 작업이에요."),
    RESULT_ALREADY_REPORTED("REC_021", 409, "이미 결과가 기록된 작업이에요."),
    JOB_REASSIGNED("REC_022", 409, "다른 워커에 다시 배정된 작업이에요."),
    /** 결과 보고의 코 편집 검사기가 지금 답하지 못한다(바쁨·장애). 워커는 같은 결과를 다시 보낸다(S15P31B204-592). */
    RESULT_CHECK_UNAVAILABLE("REC_023", 503, "결과를 지금 검사할 수 없어요. 같은 결과를 잠시 뒤 다시 보내 주세요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    ReconstructionErrorCode(String code, int httpStatus, String message) {
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
