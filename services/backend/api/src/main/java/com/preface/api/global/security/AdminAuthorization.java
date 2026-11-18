package com.preface.api.global.security;

import jakarta.servlet.http.HttpServletRequest;
import java.util.function.Supplier;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

/**
 * {@code /api/v1/admin/**} 권한 검사(S15P31B204-651).
 *
 * <p>일반 세션({@code scope=user})이고 DB의 {@code user.role}이 ADMIN이어야 통과한다. 권한을 JWT에 싣지 않고 요청마다 DB를 읽는다
 * — ADMIN은 DB에서만 주고 빼므로, 바꾸면 다음 요청부터 바로 반영돼야 한다(토큰 재발급을 기다리지 않는다). 관리자 API에서만 조회하므로 일반 API 비용은 늘지
 * 않는다.
 *
 * <p>거절 응답: 로그인 안 함은 기존대로 AUTH_001·002(entry point), 가입·업로드 전용 세션은 AUTH_024·023, 로그인했지만 관리자가 아니면
 * ADM_001이다. 마지막 경우를 {@link SecurityErrorResponses}가 알 수 있게 요청 속성 {@link #DENIED_ATTRIBUTE}를 남긴다.
 */
public class AdminAuthorization implements AuthorizationManager<RequestAuthorizationContext> {

    static final String DENIED_ATTRIBUTE = AdminAuthorization.class.getName() + ".denied";

    private final AdminRoleLookup lookup;

    public AdminAuthorization(AdminRoleLookup lookup) {
        this.lookup = lookup;
    }

    @Override
    public AuthorizationDecision authorize(
            Supplier<? extends Authentication> authentication,
            RequestAuthorizationContext context) {
        return new AuthorizationDecision(decide(authentication.get(), context.getRequest()));
    }

    boolean decide(Authentication authentication, HttpServletRequest request) {
        if (authentication == null
                || !(authentication.getPrincipal() instanceof AuthPrincipal principal)
                || principal.scope() != TokenScope.USER) {
            return false;
        }
        if (lookup.isActiveAdmin(principal.subject())) {
            return true;
        }
        request.setAttribute(DENIED_ATTRIBUTE, Boolean.TRUE);
        return false;
    }
}
