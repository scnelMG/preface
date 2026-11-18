package com.preface.common.facemodel.entity;

/** 설문용 얼굴 사진 방향. DDL {@code ck_face_capture_image_angle}, 워커 계약 {@code captureImages} 키와 같다. */
public enum CaptureAngle {
    FRONT,
    LEFT,
    RIGHT,
    LEFT_45,
    RIGHT_45;

    /** S3 파일 이름: {@code captures/left_45.jpg}. */
    public String fileName() {
        return "captures/" + name().toLowerCase() + ".jpg";
    }
}
