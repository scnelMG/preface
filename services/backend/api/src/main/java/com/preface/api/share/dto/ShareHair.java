package com.preface.api.share.dto;

import com.preface.api.hair.dto.HairTemplateListResponse;

/**
 * 공유 보기의 헤어. {@code template}은 API-HAIR-01 항목과 같은 모양(URL은 presigned 10분), {@code targetRgb}는 3D 모델이
 * 추정한 머리색 {@code #rrggbb}(없으면 {@code null}, FE는 기본색 그대로 그린다).
 */
public record ShareHair(HairTemplateListResponse.Item template, String targetRgb) {}
