package com.preface.common.error;

/** 편집(EDIT) 에러. API 명세서 v2.7 "8. 에러 코드 전체". */
public enum EditErrorCode implements ErrorCode {
    UNKNOWN_MORPH_CODE("EDIT_001", 400, "지원하지 않는 조절 항목이에요."),
    STATE_VERSION_CONFLICT("EDIT_002", 409, "다른 곳에서 먼저 바뀌었어요. 최신 상태를 불러올게요."),
    NOTHING_TO_UNDO("EDIT_003", 409, "되돌릴 변경이 없어요."),
    NOTHING_TO_REDO("EDIT_004", 409, "앞으로 갈 변경이 없어요."),
    /** API-HAIR-02. 없거나 노출하지 않는(active=0) 템플릿. */
    HAIR_TEMPLATE_NOT_FOUND("EDIT_010", 404, "헤어를 찾을 수 없어요."),
    FACE_MODEL_NOT_READY("EDIT_020", 409, "3D가 아직 완성되지 않았어요."),
    /** 이 3D는 채팅 적용이 열려 있지 않다(S15P31B204-307). 변경 요청 자체가 반영 불가인 CON_010과 다르다. */
    CHAT_APPLY_NOT_SUPPORTED("EDIT_030", 409, "이 3D는 아직 대화로 바로 바꿀 수 없어요. 얼굴은 바꾸지 않았어요."),
    NOSE_EDIT_NOT_READY("EDIT_031", 409, "이 3D의 코 편집 검사가 준비되지 않았어요. 얼굴은 바꾸지 않았어요."),
    UNSAFE_NOSE_EDIT("EDIT_032", 409, "이 조절은 코 모양을 안전하게 유지할 수 없어 적용하지 않았어요."),
    UNSAFE_CONTOUR_EDIT("EDIT_033", 409, "이 조합은 함께 적용하기 어려워요. 한 부위씩 조금씩 조절해 주세요. 얼굴은 바꾸지 않았어요.");

    private final String code;
    private final int httpStatus;
    private final String message;

    EditErrorCode(String code, int httpStatus, String message) {
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
