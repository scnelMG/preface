package com.preface.api.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

class AdminAuthorizationTest {

    private static final String USER_ID = "00000000-0000-0000-0000-000000000001";

    private final AdminRoleLookup lookup = mock(AdminRoleLookup.class);
    private final AdminAuthorization authorization = new AdminAuthorization(lookup);

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void DB에서_ADMIN인_일반_세션은_통과한다() {
        when(lookup.isActiveAdmin(USER_ID)).thenReturn(true);
        MockHttpServletRequest request = new MockHttpServletRequest();

        assertThat(authorization.decide(auth(TokenScope.USER), request)).isTrue();
        assertThat(request.getAttribute(AdminAuthorization.DENIED_ATTRIBUTE)).isNull();
    }

    @Test
    void 관리자가_아닌_회원은_거절하고_ADM_001로_응답한다() throws Exception {
        when(lookup.isActiveAdmin(USER_ID)).thenReturn(false);
        MockHttpServletRequest request = new MockHttpServletRequest();
        Authentication authentication = auth(TokenScope.USER);

        assertThat(authorization.decide(authentication, request)).isFalse();

        SecurityContextHolder.getContext().setAuthentication(authentication);
        MockHttpServletResponse response = new MockHttpServletResponse();
        SecurityErrorResponses.accessDeniedHandler()
                .handle(request, response, new AccessDeniedException("denied"));
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString(StandardCharsets.UTF_8))
                .contains("\"code\":\"ADM_001\"");
    }

    @Test
    void 업로드_전용_세션은_DB를_보지_않고_거절하며_기존_AUTH_023을_준다() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        Authentication authentication = auth(TokenScope.CAPTURE);

        assertThat(authorization.decide(authentication, request)).isFalse();
        verify(lookup, never()).isActiveAdmin(anyString());

        SecurityContextHolder.getContext().setAuthentication(authentication);
        MockHttpServletResponse response = new MockHttpServletResponse();
        SecurityErrorResponses.accessDeniedHandler()
                .handle(request, response, new AccessDeniedException("denied"));
        assertThat(response.getContentAsString(StandardCharsets.UTF_8))
                .contains("\"code\":\"AUTH_023\"");
    }

    @Test
    void 인증_정보가_없으면_거절한다() {
        assertThat(authorization.decide(null, new MockHttpServletRequest())).isFalse();
        verify(lookup, never()).isActiveAdmin(anyString());
    }

    private static Authentication auth(TokenScope scope) {
        return new UsernamePasswordAuthenticationToken(
                new AuthPrincipal(USER_ID, scope),
                null,
                List.of(new SimpleGrantedAuthority(scope.authority())));
    }
}
