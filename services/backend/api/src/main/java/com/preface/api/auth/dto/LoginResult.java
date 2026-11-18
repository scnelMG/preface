package com.preface.api.auth.dto;

/**
 * @param refreshToken 기존 회원 로그인일 때만 값이 있다
 */
public record LoginResult(LoginResponse body, String refreshToken) {}
