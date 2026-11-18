package com.preface.api.global.config;

import com.preface.api.global.security.AdminAuthorization;
import com.preface.api.global.security.AdminRoleLookup;
import com.preface.api.global.security.AuthProperties;
import com.preface.api.global.security.CaptureSessionRevocations;
import com.preface.api.global.security.JwtAuthenticationFilter;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.SecurityErrorResponses;
import com.preface.api.global.security.TokenScope;
import com.preface.api.global.security.WithdrawnUsers;
import java.time.Clock;
import java.util.List;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * 보안 설정.
 *
 * <ul>
 *   <li>세션을 만들지 않는다(JWT Bearer). 그래서 CSRF 토큰도 쓰지 않는다. refresh token 쿠키는 {@code SameSite=Strict}로
 *       보호한다(API 명세서 "인증").
 *   <li>인증 없이 여는 API는 아래 목록뿐이다(API 명세서 "비로그인 체험"). 나머지는 일반 세션({@code scope=user})이 필요하다.
 *   <li>관리자 API({@code /api/v1/admin/**})는 일반 세션에 더해 DB의 {@code user.role = ADMIN}이 필요하다({@link
 *       AdminAuthorization}).
 *   <li>가입 완료(AUTH-08)는 가입 토큰을 서비스에서 직접 검사한다. 토큰 문제를 AUTH_032로 돌려줘야 해서다.
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({AuthProperties.class, CorsProperties.class})
public class SecurityConfig {

    /**
     * 업로드 전용 세션 허용 API(API 명세서 "업로드 전용 세션"): CAP-01·02, REC-01·02, QR-04, multipart 업로드
     * (S15P31B204-506, 명세 반영 전).
     */
    private static final String[] CAPTURE_POST_APIS = {
        "/api/v1/uploads",
        "/api/v1/uploads/multipart",
        "/api/v1/uploads/*/parts",
        "/api/v1/uploads/*/complete",
        "/api/v1/reconstructions"
    };

    private static final String[] CAPTURE_GET_APIS = {
        "/api/v1/uploads/policy", "/api/v1/reconstructions/*"
    };

    private static final String[] USER_OR_CAPTURE = {
        TokenScope.USER.authority(), TokenScope.CAPTURE.authority()
    };

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    /**
     * 허용 출처에서 오는 브라우저 요청만 받는다. refresh 쿠키를 주고받아야 해서 credentials를 허용하고, 그래서 출처는 와일드카드 없이 정확한 주소만
     * 둔다(credentials와 {@code *}는 함께 쓸 수 없다).
     */
    @Bean
    CorsConfigurationSource corsConfigurationSource(CorsProperties properties) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(properties.allowedOrigins());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            JwtProvider jwtProvider,
            CaptureSessionRevocations captureRevocations,
            WithdrawnUsers withdrawnUsers,
            AdminRoleLookup adminRoleLookup)
            throws Exception {
        return http.csrf(csrf -> csrf.disable())
                // preflight(OPTIONS)는 인증 필터보다 먼저 CORS 필터가 처리한다
                .cors(cors -> {})
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .logout(logout -> logout.disable())
                .sessionManagement(
                        session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .addFilterBefore(
                        new JwtAuthenticationFilter(
                                jwtProvider, captureRevocations, withdrawnUsers),
                        UsernamePasswordAuthenticationFilter.class)
                .authorizeHttpRequests(
                        auth ->
                                auth.requestMatchers(
                                                "/actuator/health",
                                                "/actuator/health/**",
                                                // 내부 모니터링 수집용. 프록시가 /api/*만 내보내 밖에서는 닿지 않는다
                                                "/actuator/prometheus",
                                                "/v3/api-docs/**",
                                                "/swagger-ui/**",
                                                "/swagger-ui.html")
                                        .permitAll()
                                        // 관리자 API(S15P31B204-651): 일반 세션 + DB의 user.role = ADMIN.
                                        // 아니면 ADM_001
                                        .requestMatchers("/api/v1/admin/**")
                                        .access(new AdminAuthorization(adminRoleLookup))
                                        // 업로드 전용 세션(capture) 허용 API. 그 외는 AUTH_023
                                        .requestMatchers(
                                                HttpMethod.POST, "/api/v1/capture-links/exchange")
                                        .permitAll()
                                        // 시안 공유 보기(API-SHR-04). 토큰으로만 열고 나머지 공유 API는 로그인 필요
                                        .requestMatchers(HttpMethod.GET, "/api/v1/shares/*")
                                        .permitAll()
                                        .requestMatchers(
                                                HttpMethod.GET, "/api/v1/reconstructions/current")
                                        .hasAuthority(TokenScope.USER.authority())
                                        .requestMatchers(HttpMethod.POST, CAPTURE_POST_APIS)
                                        .hasAnyAuthority(USER_OR_CAPTURE)
                                        .requestMatchers(HttpMethod.GET, CAPTURE_GET_APIS)
                                        .hasAnyAuthority(USER_OR_CAPTURE)
                                        .requestMatchers(
                                                HttpMethod.DELETE,
                                                "/api/v1/capture-links/*",
                                                "/api/v1/uploads/*")
                                        .hasAnyAuthority(USER_OR_CAPTURE)
                                        .requestMatchers(
                                                HttpMethod.GET,
                                                "/api/v1/auth/oauth/*/authorize-url",
                                                "/api/v1/consent-documents",
                                                "/api/v1/morph-parameters")
                                        .permitAll()
                                        .requestMatchers(
                                                HttpMethod.POST,
                                                "/api/v1/auth/oauth/*/login",
                                                "/api/v1/auth/token/refresh",
                                                "/api/v1/auth/signup")
                                        .permitAll()
                                        .anyRequest()
                                        .hasAuthority(TokenScope.USER.authority()))
                .exceptionHandling(
                        ex ->
                                ex.authenticationEntryPoint(SecurityErrorResponses.entryPoint())
                                        .accessDeniedHandler(
                                                SecurityErrorResponses.accessDeniedHandler()))
                .build();
    }
}
