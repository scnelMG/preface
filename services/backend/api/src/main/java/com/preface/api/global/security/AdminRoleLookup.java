package com.preface.api.global.security;

/**
 * 관리자 여부 조회(S15P31B204-651). 구현은 {@code com.preface.api.admin.service.AdminRoleService}가 DB에서 한다.
 *
 * <p>global이 도메인 패키지(admin)에 의존하지 않게 인터페이스만 여기 둔다. admin은 이미 global({@link AuthPrincipal})을 쓰므로 반대
 * 방향 의존을 만들면 순환 의존 규칙(ArchitectureTest)에 걸린다.
 */
public interface AdminRoleLookup {

    /** 탈퇴하지 않은 회원이고 {@code user.role = ADMIN}이면 true. */
    boolean isActiveAdmin(String userId);
}
