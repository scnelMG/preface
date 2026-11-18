package com.preface.api.auth.dto;

public record TokenResponse(String accessToken, long expiresIn) {}
