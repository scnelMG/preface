package com.preface.common.notification.entity;

/** 알림 종류(1차). 문구는 서버 고정 문구다(금칙어 예외 목록 관리, R-01). */
public enum NotificationType {
    RECON_SUCCEEDED("원본 3D가 생성됐어요", "작업실에서 확인해 보세요.", NotificationTargetKind.FACE_MODEL),
    RECON_FAILED("3D를 만들지 못했어요", "이유와 고치는 방법을 확인해 주세요.", NotificationTargetKind.RECON_JOB);

    private final String title;
    private final String body;
    private final NotificationTargetKind targetKind;

    NotificationType(String title, String body, NotificationTargetKind targetKind) {
        this.title = title;
        this.body = body;
        this.targetKind = targetKind;
    }

    public String title() {
        return title;
    }

    public String body() {
        return body;
    }

    public NotificationTargetKind targetKind() {
        return targetKind;
    }
}
