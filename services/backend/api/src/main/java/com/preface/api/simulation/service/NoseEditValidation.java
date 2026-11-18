package com.preface.api.simulation.service;

import com.preface.api.simulation.dto.PointStroke;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** INT-AI-02 결과를 저장하기 전에 원본·리그 결속과 실제 코 값이 요청 안에 있는지 확인한다. */
public final class NoseEditValidation {

    private NoseEditValidation() {}

    public record Binding(
            String meshSha256,
            String rigSha256,
            String fitSha,
            String engine,
            String rigVersion,
            String topologyVersion) {}

    public record Result(
            boolean valid,
            Map<String, Double> actualWeights,
            List<PointStroke> actualPointStrokes,
            String meshSha256,
            String rigSha256,
            String fitSha,
            String engine,
            String rigVersion,
            String topologyVersion,
            boolean canonicalValid,
            boolean skinValid,
            int selfIntersections) {
        public Result(
                boolean valid,
                Map<String, Double> actualWeights,
                String meshSha256,
                String rigSha256,
                String fitSha,
                String engine,
                String rigVersion,
                String topologyVersion,
                boolean canonicalValid,
                boolean skinValid,
                int selfIntersections) {
            this(
                    valid,
                    actualWeights,
                    null,
                    meshSha256,
                    rigSha256,
                    fitSha,
                    engine,
                    rigVersion,
                    topologyVersion,
                    canonicalValid,
                    skinValid,
                    selfIntersections);
        }
    }

    public record Checked(Map<String, Double> weights, List<PointStroke> points) {}

    public static Map<String, Double> requireSafeActual(
            Binding approved,
            Map<String, MorphRange> supported,
            Map<String, Double> current,
            Map<String, Double> candidate,
            Result result) {
        if (approved == null
                || supported == null
                || current == null
                || candidate == null
                || result == null
                || !result.valid()
                || !result.canonicalValid()
                || !result.skinValid()
                || result.selfIntersections() != 0
                || !matches(approved.meshSha256(), result.meshSha256())
                || !matches(approved.rigSha256(), result.rigSha256())
                || !matches(approved.fitSha(), result.fitSha())
                || !matches(approved.engine(), result.engine())
                || !matches(approved.rigVersion(), result.rigVersion())
                || !matches(approved.topologyVersion(), result.topologyVersion())
                || result.actualWeights() == null) {
            throw new InvalidResult();
        }
        Set<String> codes = new HashSet<>(current.keySet());
        codes.addAll(candidate.keySet());
        codes.addAll(result.actualWeights().keySet());
        for (String code : codes) {
            MorphRange range = supported.get(code);
            Double before = current.getOrDefault(code, 0.0);
            Double wanted = candidate.getOrDefault(code, 0.0);
            Double actual = result.actualWeights().getOrDefault(code, 0.0);
            if (range == null
                    || !code.startsWith("nose.")
                    || before == null
                    || wanted == null
                    || actual == null
                    || !inRange(before, range)
                    || !inRange(wanted, range)
                    || !inRange(actual, range)
                    || actual != MorphEdits.round(actual)
                    || actual < Math.min(before, wanted)
                    || actual > Math.max(before, wanted)) {
                throw new InvalidResult();
            }
        }
        return Map.copyOf(result.actualWeights());
    }

    public static Checked requireSafeActual(
            Binding approved,
            Map<String, MorphRange> supported,
            Map<String, Double> current,
            Map<String, Double> candidate,
            List<PointStroke> currentPoints,
            List<PointStroke> candidatePoints,
            Result result) {
        Map<String, Double> weights =
                requireSafeActual(approved, supported, current, candidate, result);
        if (currentPoints == null
                || candidatePoints == null
                || (result.actualPointStrokes() == null && !candidatePoints.isEmpty())
                || (result.actualPointStrokes() != null
                        && !result.actualPointStrokes().equals(candidatePoints))) {
            throw new InvalidResult();
        }
        requirePointShape(candidatePoints);
        return new Checked(weights, List.copyOf(candidatePoints));
    }

    public static void requirePointShape(List<PointStroke> points) {
        if (points == null || points.size() > 24) throw new InvalidResult();
        for (PointStroke point : points) {
            if (point == null
                    || point.vertex() < 0
                    || point.delta() == null
                    || point.delta().size() != 3
                    || point.delta().stream().anyMatch(v -> v == null || !Double.isFinite(v))
                    || Math.hypot(
                                    Math.hypot(point.delta().get(0), point.delta().get(1)),
                                    point.delta().get(2))
                            > 0.01
                    || point.delta().stream().allMatch(v -> v == 0.0)
                    || point.delta().stream()
                            .anyMatch(
                                    v ->
                                            v
                                                    != BigDecimal.valueOf(v)
                                                            .setScale(4, RoundingMode.HALF_UP)
                                                            .doubleValue())) {
                throw new InvalidResult();
            }
        }
    }

    private static boolean inRange(double value, MorphRange range) {
        return Double.isFinite(value) && value >= range.min() && value <= range.max();
    }

    private static boolean matches(String expected, String actual) {
        return expected != null && !expected.isBlank() && Objects.equals(expected, actual);
    }

    public static final class InvalidResult extends RuntimeException {
        InvalidResult() {
            super("invalid nose edit validation result");
        }
    }

    public static final class UnsafeResult extends RuntimeException {}

    /**
     * 검사기 자체가 답하지 못했다(차례를 못 받은 503 BUSY·검사 스레드 장애 503 UNAVAILABLE·연결 실패·응답 시간 초과). 입력은 틀리지 않았을 수 있어
     * 같은 요청을 다시 보내면 될 수 있다(S15P31B204-592).
     */
    public static final class Unavailable extends RuntimeException {
        Unavailable() {
            super("nose edit validator unavailable");
        }
    }
}
