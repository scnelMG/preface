package com.preface.api.auth.dto;

/** 가입 동의 화면에 보여 줄 제공자 정보. 이메일은 마스킹해서만 내린다. */
public record SignupProfile(String provider, String nickname, String maskedEmail) {}
