package com.preface.api.consult.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 편집 후보 효과 하나({@code contracts/edit/consult-apply-v1.md} {@code actions[]}).
 *
 * @param code 효과 코드(좌우 없는 이름, 예: {@code eye.tail_angle}, {@code nose.tip_projection})
 * @param side {@code left|right|both} — 사용자 본인 기준. 코는 항상 {@code both}
 * @param direction {@code 1}(증가·상향·전방) 또는 {@code -1}
 * @param strength {@code small|medium|large}
 * @param target 화면 범위의 절대값(-1~1). 명시한 수치를 서버가 직접 읽은 경우에만 넣는다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EditAction(
        String code, String side, int direction, String strength, String source, Double target) {
    public EditAction(String code, String side, int direction, String strength, String source) {
        this(code, side, direction, strength, source, null);
    }

    public EditAction(String code, String side, int direction, String strength) {
        this(code, side, direction, strength, null);
    }
}
