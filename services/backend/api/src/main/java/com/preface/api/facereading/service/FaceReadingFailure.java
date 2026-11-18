package com.preface.api.facereading.service;

/**
 * 관상 생성이 실패한 이유. 사용자 응답이 아니라 {@code face_reading.fail_code}에 남는다(비동기라 요청은 이미 끝났다). 코드는 로그·운영 확인용이고,
 * 화면은 "다시 시도"만 보여 준다.
 */
public class FaceReadingFailure extends RuntimeException {

    /** 3D가 끝나 프레임 묶음이 지워졌다. */
    public static final String PHOTO_GONE = "PHOTO_GONE";

    /** 묶음에 쓸 만한 정면 프레임이 없다(얼굴 없음·각도 초과). */
    public static final String NO_FRONT = "NO_FRONT";

    /** 묶음 형식이 예상과 다르다(prepare.json·이미지 누락, 깨진 tar·JPEG). */
    public static final String BAD_BUNDLE = "BAD_BUNDLE";

    /** GMS 장애·시간 초과·잔액 바닥. */
    public static final String AI_UNAVAILABLE = "AI_UNAVAILABLE";

    /** GMS가 거절했거나 결과가 형식·금지 표현 검사를 통과하지 못했다. */
    public static final String AI_REJECTED = "AI_REJECTED";

    /** 처리 대기열이 가득 찼다. */
    public static final String BUSY = "BUSY";

    private final String code;

    public FaceReadingFailure(String code, String detail) {
        super(detail);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
