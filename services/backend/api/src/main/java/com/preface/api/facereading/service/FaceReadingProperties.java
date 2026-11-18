package com.preface.api.facereading.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 관상 설정({@code preface.face-reading}). GMS 주소·키는 상담과 같은 {@code preface.ai}·{@code GMS_KEY}를 쓴다.
 *
 * @param model GMS 모델(상담과 같은 모델, 이미지 입력 가능)
 * @param readTimeout 이미지 호출은 상담(18초)보다 오래 걸려 따로 둔다
 * @param stallAfter PENDING이 이보다 오래 그대로면 서버 재시작 등으로 작업이 사라진 것으로 보고 다시 요청할 수 있게 한다
 */
@ConfigurationProperties("preface.face-reading")
public record FaceReadingProperties(String model, Duration readTimeout, Duration stallAfter) {

    public FaceReadingProperties {
        model = model == null || model.isBlank() ? "gpt-6-luna" : model.strip();
        readTimeout = readTimeout == null ? Duration.ofSeconds(60) : readTimeout;
        stallAfter = stallAfter == null ? Duration.ofMinutes(5) : stallAfter;
    }
}
