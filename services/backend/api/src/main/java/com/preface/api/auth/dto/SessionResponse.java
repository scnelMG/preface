package com.preface.api.auth.dto;

/** 가입 완료(API-AUTH-08) 응답. refresh token은 본문이 아니라 쿠키로 내린다. */
public record SessionResponse(String accessToken, long expiresIn, UserSummary user) {}
