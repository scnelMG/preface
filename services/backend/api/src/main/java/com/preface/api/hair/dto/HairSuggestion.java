package com.preface.api.hair.dto;

/**
 * 3D 상세(API-HIS-02)에 싣는 추정 머리 속성과 추천 템플릿(S15P31B204-551). 각 값은 추정하지 못했으면 {@code null}이다.
 *
 * @param part 정면 사진을 보는 사람 기준 좌우
 * @param rgb 추정 머리색 {@code #rrggbb}. FE 헤어 색 보정의 목표색
 * @param recommendedHairTemplateId 바인딩이 있는 노출 템플릿 중 가장 닮은 것. 없으면 {@code null}
 */
public record HairSuggestion(
        String length,
        String bangs,
        String part,
        String color,
        String rgb,
        String recommendedHairTemplateId) {}
