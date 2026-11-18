package com.preface.api.share.dto;

import jakarta.validation.constraints.Pattern;

/**
 * API-SHR-01 요청(선택). 본문이 없어도 되고, 두 값 모두 선택이다.
 *
 * @param hairAssetId 편집실에서 씌워 둔 웹 헤어 ID(예: {@code dandy}). 없으면 {@code null}. 서버는 웹 헤어 목록을 모르므로 모양만
 *     검사하고, 모르는 ID는 웹이 그리지 않는다(S15P31B204-842)
 * @param senderName 받는 사람에게 보일 이름(S15P31B204-843). 공유한 사람이 직접 적은 값만 받는다(계정 닉네임을 대신 넣지 않는다). 비었거나
 *     공백뿐이면 이름 없이 만든다. 규칙은 {@code ShareSenderName}이 검사한다
 */
public record ShareCreateRequest(
        @Pattern(regexp = "[a-z0-9-]{1,36}") String hairAssetId, String senderName) {

    @Override
    public String toString() {
        return "ShareCreateRequest[hairAssetId=" + hairAssetId + ", senderName=<redacted>]";
    }
}
