package com.preface.api.facemodel.dto;

import com.preface.api.hair.dto.HairSuggestion;
import java.time.Instant;

/**
 * API-HIS-02. 메시·텍스처는 presigned GET(10분)이다. 만료되면 FE가 다시 호출한다. {@code measurements}는 내리지 않는다(AI 입력
 * 전용).
 *
 * @param textureUrl 텍스처가 없는 결과면 {@code null}
 * @param rigUrl 생성 리그가 없는 이전 모델이면 {@code null}
 * @param expressionUrl 표정 트래킹 리그(S15P31B204-879). 없는 모델이면 {@code null}이고 편집실 표정 트래킹을 켜지 않는다
 * @param urlExpiresAt 메시 URL 만료 시각(텍스처·리그·표정 리그도 같은 시각에 서명한다)
 * @param hair 추정 머리 속성과 추천 헤어 템플릿(S15P31B204-551). 추정 결과가 없는 모델이면 {@code null}
 */
public record FaceModelDetailResponse(
        String faceModelId,
        String meshUrl,
        String rigUrl,
        String expressionUrl,
        String textureUrl,
        String meshFormat,
        String morphSchemaVersion,
        Instant urlExpiresAt,
        Instant createdAt,
        HairSuggestion hair) {

    public FaceModelDetailResponse(
            String faceModelId,
            String meshUrl,
            String rigUrl,
            String textureUrl,
            String meshFormat,
            String morphSchemaVersion,
            Instant urlExpiresAt,
            Instant createdAt) {
        this(
                faceModelId,
                meshUrl,
                rigUrl,
                null,
                textureUrl,
                meshFormat,
                morphSchemaVersion,
                urlExpiresAt,
                createdAt,
                null);
    }

    @Override
    public String toString() {
        return "FaceModelDetailResponse[faceModelId="
                + faceModelId
                + ", meshUrl=<redacted>, rigUrl=<redacted>, expressionUrl=<redacted>,"
                + " textureUrl=<redacted>, urlExpiresAt="
                + urlExpiresAt
                + "]";
    }
}
