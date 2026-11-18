package com.preface.common.capture.entity;

/** 영상을 어떻게 얻었는지(S15P31B204-617). DDL {@code ck_face_upload_capture_method}. */
public enum CaptureMethod {
    /** 웹 실시간 촬영 가이드로 브라우저에서 녹화. 영상에 기기·렌즈 기록이 없다 */
    WEB_RECORDER,
    /** 파일 올리기(팀 작업용, 나중에 없앤다) */
    FILE
}
