package com.preface.api.capture.dto;

/**
 * QR 링크 상태. WAITING(교환 전) → CONNECTED(휴대폰 연결) → UPLOADED(복원 작업 생성). 끝: EXPIRED(시간 초과·새 QR로 대체),
 * CANCELED(연결 끊기).
 */
public enum CaptureLinkStatus {
    WAITING,
    CONNECTED,
    UPLOADED,
    EXPIRED,
    CANCELED
}
