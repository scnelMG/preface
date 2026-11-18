package com.preface.api.simulation.dto;

/** 복원 워커가 GLB와 함께 보고한 눈별 기존 쌍꺼풀 판정. */
public record EyeReview(String R, String L) {
    public boolean known() {
        return known(R) && known(L);
    }

    private static boolean known(String value) {
        return "present".equals(value) || "absent".equals(value);
    }
}
