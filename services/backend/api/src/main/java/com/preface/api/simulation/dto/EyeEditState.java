package com.preface.api.simulation.dto;

import java.util.List;

/** 눈별 편집 상태. GLB의 L/R 축을 그대로 쓰며 화면 좌우와는 반대다. */
public record EyeEditState(EyeSettings L, EyeSettings R) {
    public record EyeSettings(boolean enabled, String style, Values values, List<Double> curve) {}

    public record Values(
            double height, double crease, double inner, double outer, double lower, double upper) {}

    public static EyeEditState initial() {
        return new EyeEditState(initialEye(), initialEye());
    }

    private static EyeSettings initialEye() {
        return new EyeSettings(false, "inout", new Values(20, 65, 0, 0, 0, 0), curve(20, "inout"));
    }

    /** 현재 화면의 높이·모양만으로 만드는 5점 설계선(구간별 독립 편집은 출시 범위 밖). */
    public static List<Double> curve(double height, String style) {
        double h = 0.09 + 0.16 * height / 100;
        double[] factors =
                switch (style) {
                    case "inline" -> new double[] {0.08, 0.55, 0.95, 1.1, 1.2};
                    case "outline" -> new double[] {0.85, 1, 1.05, 1.1, 1.2};
                    default -> new double[] {0.35, 0.82, 1, 1.1, 1.2};
                };
        double[] arch = {0, 0.6, 1, 0.6, 0};
        return java.util.stream.IntStream.range(0, 5)
                .mapToObj(i -> Math.max(0.005, Math.min(0.36, h * factors[i] - 0.036 * arch[i])))
                .toList();
    }
}
