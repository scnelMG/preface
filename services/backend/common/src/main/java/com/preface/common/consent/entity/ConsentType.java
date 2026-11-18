package com.preface.common.consent.entity;

/** 동의서 종류. 4종 모두 필수이고 가입 때 한 번에 제출한다(REQ-F-32). */
public enum ConsentType {
    TERMS,
    PRIVACY,
    FACE_DATA,
    FACE_PUBLIC
}
