package com.preface.common.capture.entity;

/** {@code face_upload.status}. ISSUED(URL 발급) → UPLOADED(객체 확인, API-REC-01) → DELETED·EXPIRED. */
public enum FaceUploadStatus {
    ISSUED,
    UPLOADED,
    DELETED,
    EXPIRED
}
