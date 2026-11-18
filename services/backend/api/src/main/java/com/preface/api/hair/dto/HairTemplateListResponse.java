package com.preface.api.hair.dto;

import java.time.Instant;
import java.util.List;

/**
 * API-HAIR-01. 메시·바인딩·썸네일은 presigned GET(10분)이다. 공용 자산이지만 버킷이 비공개라 서명한다.
 *
 * @param urlExpiresAt 이 응답의 모든 URL이 같은 시각에 만료된다
 */
public record HairTemplateListResponse(List<Item> templates, Instant urlExpiresAt) {

    /**
     * @param bindingUrl 템플릿 삼각형 바인딩 파일. FE가 이것으로 헤어를 사용자 머리에 맞춘다. 없으면 맞출 수 없는 템플릿이다
     * @param headTemplate 바인딩한 머리 템플릿·위상 버전. 복원 메시와 다르면 FE가 적용하지 않는다
     * @param baseRgb 텍스처 기본색 {@code #rrggbb}. FE 색 보정(목표색 ÷ 기본색)의 기준
     */
    public record Item(
            String hairTemplateId,
            String name,
            String meshUrl,
            String bindingUrl,
            String thumbnailUrl,
            String headTemplate,
            String length,
            String bangs,
            String part,
            String baseRgb) {

        @Override
        public String toString() {
            return "Item[hairTemplateId="
                    + hairTemplateId
                    + ", name="
                    + name
                    + ", meshUrl=<redacted>, bindingUrl=<redacted>, thumbnailUrl=<redacted>]";
        }
    }
}
