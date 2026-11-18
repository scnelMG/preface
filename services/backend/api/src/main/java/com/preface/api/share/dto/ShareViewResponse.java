package com.preface.api.share.dto;

import com.preface.api.simulation.dto.EyeReview;
import com.preface.api.simulation.dto.MorphState;
import java.time.Instant;

/**
 * API-SHR-04(인증 없음). 받은 사람이 Before/After를 그리는 데 필요한 것만 준다. 사용자 정보(닉네임·이메일)·ID·시안 제목·측정값·상담은 넣지 않는다.
 * 공유한 사람이 직접 적은 보내는 사람 이름만 예외로 넣는다(S15P31B204-843).
 *
 * <p>파일 URL은 매 요청 새로 서명한 presigned GET(10분)이다. 만료되면 FE가 다시 부른다.
 *
 * @param rigUrl 생성 리그가 없는 이전 모델이면 {@code null}
 * @param textureUrl 텍스처가 없는 결과면 {@code null}
 * @param morphState 공유 시점 스냅숏(weights·pointStrokes·eyeEdit)
 * @param eyeReview 3D 모델의 눈 판정. 없으면 {@code null}(FE는 눈 편집을 그리지 않는다)
 * @param hair 공유 시점 헤어. 없거나 지금 노출하지 않는 템플릿이면 {@code null}
 * @param hairAssetId 공유 시점 웹 헤어 ID(편집실 정적 헤어, S15P31B204-842). 없으면 {@code null}
 * @param senderName 공유한 사람이 링크를 만들 때 적은 이름. 적지 않았으면 {@code null}(계정 닉네임으로 채우지 않는다)
 * @param expiresAt 공유 링크 만료 시각
 * @param urlExpiresAt 파일 URL 만료 시각
 */
public record ShareViewResponse(
        String meshUrl,
        String rigUrl,
        String textureUrl,
        String meshFormat,
        MorphState morphState,
        EyeReview eyeReview,
        ShareHair hair,
        String hairAssetId,
        String senderName,
        Instant expiresAt,
        Instant urlExpiresAt) {

    @Override
    public String toString() {
        return "ShareViewResponse[meshUrl=<redacted>, rigUrl=<redacted>, textureUrl=<redacted>,"
                + " senderName=<redacted>, expiresAt="
                + expiresAt
                + ", urlExpiresAt="
                + urlExpiresAt
                + "]";
    }
}
