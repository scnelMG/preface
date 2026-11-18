package com.preface.api.reconstruction.service;

/**
 * API-REC-01·02 호출자. 일반 세션이면 {@code captureLinkId}가 null.
 *
 * <p>TODO(S15P31B204-290): 업로드 전용 세션({@code scope=capture})을 허용할 때 컨트롤러가 {@link #capture}로 만든다. 그
 * 세션은 REC-01(만든 뒤 QR 링크를 UPLOADED·jobId로 갱신)과 REC-02(이 링크로 만든 작업만)만 부를 수 있다(API 명세서 "업로드 전용 세션").
 */
public record Requester(String userId, String captureLinkId) {

    public static Requester user(String userId) {
        return new Requester(userId, null);
    }

    public static Requester capture(String userId, String captureLinkId) {
        return new Requester(userId, captureLinkId);
    }

    public boolean isCapture() {
        return captureLinkId != null;
    }
}
