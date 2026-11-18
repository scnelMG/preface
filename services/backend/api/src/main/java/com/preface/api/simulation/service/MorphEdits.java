package com.preface.api.simulation.service;

import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * 슬라이더 편집 규칙(API-EDIT-04). DB 없이 시험할 수 있게 순수 함수로 둔다.
 *
 * <ul>
 *   <li>모르는 code(또는 비활성 항목)는 EDIT_001.
 *   <li>범위 밖 값은 거절하지 않고 {@code min/max}로 clamp하고 {@code clamped}를 켠다(명세 "범위 밖 값은 서버도 clamp").
 *   <li>값은 소수 셋째 자리로 반올림한다({@code morph_parameter}가 DECIMAL(5,3)).
 *   <li>0(원본)이 된 키는 지운다 — "누락 키는 0"이라 같은 상태가 한 가지 모양으로만 저장된다.
 * </ul>
 */
public final class MorphEdits {

    private MorphEdits() {}

    /** 슬라이더로 저장할 수 있는 부위 접두사. 코는 검사기를 거치고, 윤곽은 GLB morph target이라 범위만 확인한다. */
    static final List<String> EDITABLE_PREFIXES = List.of("nose.", "contour.");

    static boolean isEditable(String code) {
        return EDITABLE_PREFIXES.stream().anyMatch(code::startsWith);
    }

    static boolean isNose(String code) {
        return code.startsWith("nose.");
    }

    public record Requested(String code, double value) {}

    /** {@code morph_change.delta}에 저장하는 항목 하나. */
    public record Change(String code, double from, double to, boolean clamped) {}

    public record Applied(Map<String, Double> weights, List<Change> changes, boolean clamped) {}

    public static Applied apply(
            Map<String, Double> current,
            List<Requested> requested,
            Map<String, MorphRange> ranges) {
        Map<String, Double> weights = new TreeMap<>(current);
        // 같은 code가 두 번 오면 마지막 값만 쓴다.
        Map<String, Requested> lastByCode = new LinkedHashMap<>();
        for (Requested r : requested) {
            if (!isEditable(r.code()) || !ranges.containsKey(r.code())) {
                throw new BusinessException(
                        EditErrorCode.UNKNOWN_MORPH_CODE, "unknown morph code: " + r.code());
            }
            lastByCode.remove(r.code());
            lastByCode.put(r.code(), r);
        }
        List<Change> changes = new ArrayList<>();
        boolean anyClamped = false;
        for (Requested r : lastByCode.values()) {
            MorphRange range = ranges.get(r.code());
            double bounded = Math.clamp(r.value(), range.min(), range.max());
            boolean clamped = bounded != r.value();
            double to = round(bounded);
            double from = current.getOrDefault(r.code(), 0.0);
            if (to == 0.0) {
                weights.remove(r.code());
            } else {
                weights.put(r.code(), to);
            }
            changes.add(new Change(r.code(), from, to, clamped));
            anyClamped |= clamped;
        }
        return new Applied(weights, changes, anyClamped);
    }

    /** 검사기가 반환하고 서버가 재검증한 코 실제값으로 저장 상태·변경 이력을 맞춘다. 코가 아닌 값(윤곽 등)은 후보 그대로 둔다(검사기는 코만 본다). */
    public static Applied withActual(
            Map<String, Double> current, Applied candidate, Map<String, Double> actual) {
        Map<String, Double> weights = new TreeMap<>(candidate.weights());
        weights.keySet().removeIf(MorphEdits::isNose);
        actual.forEach(
                (code, value) -> {
                    if (value != 0.0) weights.put(code, value);
                });
        List<Change> changes =
                candidate.changes().stream()
                        .map(
                                c -> {
                                    if (!isNose(c.code())) return c;
                                    double to = actual.getOrDefault(c.code(), 0.0);
                                    return new Change(
                                            c.code(), c.from(), to, c.clamped() || to != c.to());
                                })
                        .toList();
        return new Applied(
                weights,
                changes,
                candidate.clamped() || changes.stream().anyMatch(Change::clamped));
    }

    /** 되돌리기·다시하기로 옮길 수 있는지: 편집할 수 없는 값(옛 눈 v1 값 등)은 그대로여야 한다. 코·윤곽은 바뀌어도 된다. */
    static boolean preservesLocked(Map<String, Double> before, Map<String, Double> after) {
        Map<String, Double> lockedBefore = new TreeMap<>(before);
        Map<String, Double> lockedAfter = new TreeMap<>(after);
        lockedBefore.keySet().removeIf(MorphEdits::isEditable);
        lockedAfter.keySet().removeIf(MorphEdits::isEditable);
        return lockedBefore.equals(lockedAfter);
    }

    /** 이력 요약. "콧대 높이 변경", "콧대 높이, 코끝 변경", "콧대 높이 외 2개 변경". */
    public static String summary(List<Change> changes, Map<String, MorphRange> ranges) {
        Set<String> labels = new LinkedHashSet<>();
        boolean coupledTip = hasCoupledTipChanges(changes);
        for (Change c : changes) {
            if (c.from() == c.to() || (coupledTip && c.code().equals("nose.tip_rotation")))
                continue;
            labels.add(
                    coupledTip && c.code().equals("nose.tip_height")
                            ? "코끝 위아래"
                            : c.code().equals("contour.weight_shape")
                                    ? "체중 변화"
                                    : c.code().equals("nose.tip_projection")
                                            ? "코끝 앞뒤"
                                            : ranges.get(c.code()).label());
        }
        List<String> list = List.copyOf(labels);
        String target =
                list.size() <= 2
                        ? String.join(", ", list)
                        : list.getFirst() + " 외 " + (list.size() - 1) + "개";
        return target + " 변경";
    }

    static boolean hasCoupledTipChanges(List<Change> changes) {
        Change height =
                changes.stream()
                        .filter(c -> c.code().equals("nose.tip_height") && c.from() != c.to())
                        .findFirst()
                        .orElse(null);
        Change rotation =
                changes.stream()
                        .filter(c -> c.code().equals("nose.tip_rotation") && c.from() != c.to())
                        .findFirst()
                        .orElse(null);
        return height != null
                && rotation != null
                && Math.abs(rotation.from() - height.from() * 2 / 3) <= 0.001
                && Math.abs(rotation.to() - height.to() * 2 / 3) <= 0.001;
    }

    /** undo 안내 문구. "콧대 높이 변경을 취소했어요.", "초기화를 취소했어요." */
    public static String undoneSummary(String summary) {
        return withObjectParticle(summary) + " 취소했어요.";
    }

    /** redo 안내 문구. "콧대 높이 변경을 다시 적용했어요." */
    public static String redoneSummary(String summary) {
        return withObjectParticle(summary) + " 다시 적용했어요.";
    }

    /** 받침이 있으면 "을", 없으면 "를". 한글이 아니면 "를". */
    static String withObjectParticle(String word) {
        char last = word.charAt(word.length() - 1);
        boolean hangul = last >= 0xAC00 && last <= 0xD7A3;
        boolean hasFinal = hangul && (last - 0xAC00) % 28 != 0;
        return word + (hasFinal ? "을" : "를");
    }

    static double round(double value) {
        return BigDecimal.valueOf(value).setScale(3, RoundingMode.HALF_UP).doubleValue();
    }
}
