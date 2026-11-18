package com.preface.api.admin.dto;

/**
 * {@code GET /api/v1/admin/me} 응답.
 *
 * @param userId 관리자 회원 ID
 * @param role 항상 {@code ADMIN}(아니면 403)
 * @param environment {@code prod} | {@code dev} | {@code local}. FE가 운영·개발 탭 표시에 쓴다
 */
public record AdminMeResponse(String userId, String role, String environment) {}
