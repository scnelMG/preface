package com.preface.api.admin.service;

import java.util.Locale;
import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 관리자 페이지({@code preface.admin.*}, S15P31B204-651).
 *
 * @param environment 지금 서버가 어느 환경인가: {@code prod} | {@code dev} | {@code local}. 배포 서버는 compose가 기존
 *     {@code STAGE} 값을 {@code ADMIN_ENVIRONMENT}로 넘긴다(새 .env 값 없음). 비어 있으면 {@code local}. 그 밖의 값이면
 *     앱이 뜨지 않는다 — 운영인데 잘못 읽혀 촬영 사진(REQ-N-25)이 열리는 일을 막는다.
 */
@ConfigurationProperties("preface.admin")
public record AdminProperties(String environment) {

    public static final String PROD = "prod";
    private static final Set<String> ALLOWED = Set.of(PROD, "dev", "local");

    public AdminProperties {
        environment =
                environment == null || environment.isBlank()
                        ? "local"
                        : environment.trim().toLowerCase(Locale.ROOT);
        if (!ALLOWED.contains(environment)) {
            throw new IllegalArgumentException(
                    "preface.admin.environment는 prod·dev·local 중 하나여야 한다: " + environment);
        }
    }

    /** 운영 환경인가. 운영에서는 촬영 사진을 내려주지 않는다(REQ-N-25). */
    public boolean isProduction() {
        return PROD.equals(environment);
    }
}
