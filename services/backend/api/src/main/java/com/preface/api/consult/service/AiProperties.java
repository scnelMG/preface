package com.preface.api.consult.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Spring 상담의 GMS 연결 설정. 키는 별도 GMS_KEY 환경 변수에서만 읽는다. */
@ConfigurationProperties("preface.ai")
public record AiProperties(
        String baseUrl, Duration connectTimeout, Duration readTimeout, String adviceModel) {

    public AiProperties(String baseUrl, Duration connectTimeout, Duration readTimeout) {
        this(baseUrl, connectTimeout, readTimeout, null);
    }

    @org.springframework.boot.context.properties.bind.ConstructorBinding
    public AiProperties {
        baseUrl = baseUrl == null ? "" : baseUrl.strip();
        connectTimeout = connectTimeout == null ? Duration.ofSeconds(2) : connectTimeout;
        readTimeout = readTimeout == null ? Duration.ofSeconds(20) : readTimeout;
        adviceModel =
                adviceModel == null || adviceModel.isBlank() ? "gpt-6-luna" : adviceModel.strip();
        if (!java.util.Set.of("gpt-6-luna", "gpt-6-sol").contains(adviceModel)) {
            throw new IllegalArgumentException("Unsupported guided consultation model");
        }
    }
}
