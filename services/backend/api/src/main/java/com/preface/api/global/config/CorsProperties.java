package com.preface.api.global.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 다른 출처(origin)에서 오는 브라우저 요청 허용 목록({@code preface.cors.*}).
 *
 * <p>배포(운영·개발)는 프록시가 웹과 {@code /api}를 같은 주소로 묶어 CORS가 필요 없으므로 비워 둔다. 로컬은 FE({@code
 * localhost:3000})와 BE({@code localhost:8080})의 포트가 달라 cross-origin이 되므로 local 프로필에서만 채운다.
 *
 * @param allowedOrigins 허용할 출처 목록. 비어 있으면 cross-origin 요청을 모두 거절한다(같은 출처 요청은 영향 없음)
 */
@ConfigurationProperties("preface.cors")
public record CorsProperties(List<String> allowedOrigins) {

    public CorsProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
    }
}
