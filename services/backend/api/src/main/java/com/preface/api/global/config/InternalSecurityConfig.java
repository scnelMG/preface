package com.preface.api.global.config;

import com.preface.api.global.security.InternalApiProperties;
import com.preface.api.global.security.InternalSecretFilter;
import com.preface.api.global.security.SecurityErrorResponses;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * 내부 API({@code /internal/**}) 전용 보안 체인. GPU 워커(외부망 Runpod)가 HTTPS로 부른다.
 *
 * <p>외부 API 체인({@link SecurityConfig})과 분리한 별도 체인이다. {@code @Order(1)}이라 먼저 검사되고, 이 경로에서는 JWT를 보지
 * 않고 공유 시크릿만 본다. 외부 체인을 고치지 않으려고 따로 두었다(다른 기능이 외부 체인 매처를 계속 추가한다).
 */
@Slf4j
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(InternalApiProperties.class)
public class InternalSecurityConfig {

    @Bean
    @Order(1)
    SecurityFilterChain internalSecurityFilterChain(
            HttpSecurity http, InternalApiProperties properties) throws Exception {
        InternalSecretFilter filter = new InternalSecretFilter(properties.secret());
        if (!filter.configured()) {
            log.warn("INTERNAL_API_SECRET이 비어 있다. 내부 API(/internal/**)가 모두 401이다");
        }
        return http.securityMatcher("/internal/**")
                .csrf(csrf -> csrf.disable())
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .logout(logout -> logout.disable())
                .requestCache(cache -> cache.disable())
                .sessionManagement(
                        session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .addFilterBefore(filter, UsernamePasswordAuthenticationFilter.class)
                .authorizeHttpRequests(
                        auth -> auth.anyRequest().hasAuthority(InternalSecretFilter.AUTHORITY))
                .exceptionHandling(
                        ex ->
                                ex.authenticationEntryPoint(SecurityErrorResponses.entryPoint())
                                        .accessDeniedHandler(
                                                SecurityErrorResponses.accessDeniedHandler()))
                .build();
    }
}
