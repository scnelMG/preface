package com.preface.api.consult.dto;

/**
 * 실제로 저장된 효과 값 하나(API-EDIT-05 {@code applied[]}). {@code limited}는 허용 범위 때문에 요청보다 줄었다는 뜻이다.
 *
 * @param code 저장 코드(눈은 좌우 포함, 예: {@code eye.tail_angle.right})
 */
public record AppliedChange(String code, double from, double to, boolean limited) {}
