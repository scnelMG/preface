package com.preface.common.user.entity;

/** 회원 권한. DDL {@code ck_user_role}과 같다(V27, S15P31B204-651). ADMIN은 DB에서만 준다. */
public enum UserRole {
    USER,
    ADMIN
}
