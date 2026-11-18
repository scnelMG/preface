package com.preface.api.share.service;

import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;

/**
 * 공유 링크의 보내는 사람 이름(S15P31B204-843). 앞뒤 공백을 지운 뒤 1~20자(코드 포인트)만 받는다. 비었으면 이름 없음({@code null})이다.
 *
 * <p>제어 문자·서식 문자(방향 바꾸기·폭 없는 문자 등)·줄/문단 구분자는 받지 않는다. 받는 사람 화면에서 글자를 숨기거나 뒤집어 보이게 하지 못하게 한다.
 * FE({@code features/share/senderName.ts})와 같은 규칙이다.
 */
final class ShareSenderName {

    static final int MAX_LENGTH = 20;

    private ShareSenderName() {}

    /**
     * @return 다듬은 이름, 비었으면 {@code null}
     * @throws BusinessException 길이·문자 규칙을 어기면 {@code COMMON_001}
     */
    static String normalize(String raw) {
        if (raw == null) {
            return null;
        }
        String name = raw.strip();
        if (name.isEmpty()) {
            return null;
        }
        if (name.codePointCount(0, name.length()) > MAX_LENGTH) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST, "senderName must be 1~20");
        }
        if (name.codePoints().anyMatch(ShareSenderName::forbidden)) {
            throw new BusinessException(
                    CommonErrorCode.INVALID_REQUEST, "senderName has control characters");
        }
        return name;
    }

    private static boolean forbidden(int codePoint) {
        int type = Character.getType(codePoint);
        return type == Character.CONTROL
                || type == Character.FORMAT
                || type == Character.LINE_SEPARATOR
                || type == Character.PARAGRAPH_SEPARATOR;
    }
}
