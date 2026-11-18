package com.preface.common.admin.entity;

/** 관리자 조회 기록의 대상 종류. DDL {@code ck_admin_access_log_target_type}과 같다(V27, USER는 V29). */
public enum AdminAccessTargetType {
    /** 복원 작업(목록·상세) */
    JOB,
    /** 3D 얼굴 모델(목록·파일) */
    FACE_MODEL,
    /** 촬영 사진(개발·로컬에서만 내려준다) */
    CAPTURE_IMAGE,
    /** 회원 한 명의 S3 저장 목록 */
    STORAGE,
    /**
     * 회원 목록·검색(S15P31B204-707). 검색어는 남기지 않는다. userId로 한 명을 찾았을 때만 대상 회원·대상 ID에 그 회원을 넣고, 목록·이름 검색이면
     * 둘 다 비운다.
     */
    USER
}
