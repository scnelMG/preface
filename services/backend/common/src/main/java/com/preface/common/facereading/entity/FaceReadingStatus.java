package com.preface.common.facereading.entity;

/** AI 관상 진행 상태. PENDING은 GMS 호출 중이고, 실패해도 3D 생성에는 영향이 없다. */
public enum FaceReadingStatus {
    PENDING,
    DONE,
    FAILED
}
