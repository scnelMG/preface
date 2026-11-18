package com.preface.api.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

class InternalSecretFilterTest {

    private static final String SECRET = "unit-test-only-internal-secret-0123456789";

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void 시크릿이_같으면_내부_워커_권한을_준다() throws Exception {
        Authentication auth = filter(new InternalSecretFilter(SECRET), SECRET);

        assertThat(auth).isNotNull();
        assertThat(auth.getAuthorities())
                .extracting(Object::toString)
                .containsExactly(InternalSecretFilter.AUTHORITY);
    }

    @Test
    void 시크릿이_다르거나_없으면_인증하지_않는다() throws Exception {
        InternalSecretFilter filter = new InternalSecretFilter(SECRET);

        assertThat(filter(filter, SECRET + "x")).isNull();
        assertThat(filter(filter, SECRET.substring(1))).isNull();
        assertThat(filter(filter, null)).isNull();
    }

    @Test
    void 시크릿이_설정되지_않으면_어떤_값도_통과하지_못한다() throws Exception {
        InternalSecretFilter filter = new InternalSecretFilter("");

        assertThat(filter.configured()).isFalse();
        assertThat(filter(filter, "")).isNull();
        assertThat(filter(filter, SECRET)).isNull();
    }

    @Test
    void 시크릿이_32바이트보다_짧으면_시작할_때_거절한다() {
        assertThatThrownBy(() -> new InternalSecretFilter("too-short"))
                .isInstanceOf(IllegalStateException.class);
    }

    private static Authentication filter(InternalSecretFilter filter, String header)
            throws Exception {
        SecurityContextHolder.clearContext();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/internal/v1/x");
        if (header != null) {
            request.addHeader(InternalSecretFilter.HEADER, header);
        }
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
        return SecurityContextHolder.getContext().getAuthentication();
    }
}
