package com.preface.api.consult.service;

import com.preface.api.consult.dto.EditAction;
import com.preface.api.simulation.service.MorphEdits;
import com.preface.common.error.BusinessException;
import com.preface.common.error.ConsultErrorCode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 상담 후보({@code actions[]}) → 저장 코드·요청값 변환. DB 없이 시험할 수 있게 순수 함수로 둔다.
 *
 * <p>규칙의 원본은 {@code contracts/edit/effects-v1.md}·{@code consult-apply-v1.md}다.
 *
 * <ul>
 *   <li>눈은 사용자 본인 기준 좌우 코드로 저장한다: {@code both} → {@code .left}·{@code .right} 두 코드, 코는 좌우가 없다.
 *   <li>값 = 현재값 + 방향 × 강도 단계. 코끝 위아래는 슬라이더처럼 높이 0.6·회전 0.4로 나눈다. 강도 단계(small 0.1·medium 0.2·large
 *       0.3)는 계약에 없어 둔 임시값이다. 범위 clamp는 {@link MorphEdits#apply}가 슬라이더와 같은 규칙으로 한다.
 *   <li>강도를 말하지 않은 요청은 상담 단계에서 {@code small}로 명시해 저장한다({@link #withDefaultStrength}).
 * </ul>
 */
public final class ConsultEdits {

    /** 강도별 한 번의 변화량(상대 weight). 임시값(S15P31B204-307 합의). */
    static final Map<String, Double> STEP = Map.of("small", 0.1, "medium", 0.2, "large", 0.3);

    /** 강도를 말하지 않은 요청의 강도. */
    static final String DEFAULT_STRENGTH = "small";

    static final Set<String> CHAT_NOSE_CODES =
            Set.of(
                    "nose.bridge_height",
                    "nose.tip_projection",
                    "nose.tip_height",
                    "nose.alar_width");
    static final Set<String> CHAT_CONTOUR_CODES =
            Set.of(
                    "contour.cheekbone",
                    "contour.cheek_volume",
                    "contour.chin_projection",
                    "contour.chin_length",
                    "contour.chin_width",
                    "contour.jaw_angle",
                    "contour.weight_shape");

    private static final Set<String> SIDES = Set.of("left", "right", "both");
    private static final Pattern EFFECT = Pattern.compile("(eye|nose|contour)\\.[a-z_]+");
    private static final Pattern EYE_STORAGE = Pattern.compile("eye\\.[a-z_]+\\.(left|right)");
    private static final Pattern NOSE_STORAGE = Pattern.compile("nose\\.[a-z_]+");

    private ConsultEdits() {}

    /** AI 후보 형식 검사(코드 모양·좌우·방향·강도). 코는 좌우가 없다. */
    public static boolean isValid(EditAction action) {
        return action != null
                && action.code() != null
                && EFFECT.matcher(action.code()).matches()
                && SIDES.contains(action.side())
                && (action.direction() == 1 || action.direction() == -1)
                && STEP.containsKey(action.strength())
                && (action.target() == null
                        || (Double.isFinite(action.target()) && Math.abs(action.target()) <= 1))
                && (!(action.code().startsWith("nose.") || action.code().startsWith("contour."))
                        || "both".equals(action.side()));
    }

    /** 강도가 비어 있으면 {@code small}을 채운다. 알 수 없는 강도는 그대로 두어 {@link #isValid}가 거른다. */
    public static EditAction withDefaultStrength(EditAction action) {
        if (action == null || (action.strength() != null && !action.strength().isBlank())) {
            return action;
        }
        return new EditAction(
                action.code(),
                action.side(),
                action.direction(),
                DEFAULT_STRENGTH,
                action.source(),
                action.target());
    }

    /**
     * 상담 {@code allowedCodes}. 시안 스키마의 활성 항목 중 v2 저장 코드 모양(코 코드, 좌우 붙은 눈 코드)만 보낸다. v1의 좌우 없는 {@code
     * eye.size}·{@code eye.tail_angle}은 v2 효과로 바꾸지 않으므로 뺀다.
     */
    public static List<String> allowedCodes(Collection<String> activeCodes) {
        return activeCodes.stream()
                .filter(
                        c ->
                                NOSE_STORAGE.matcher(c).matches()
                                        || EYE_STORAGE.matcher(c).matches()
                                        || CHAT_CONTOUR_CODES.contains(c))
                .sorted()
                .toList();
    }

    /** 효과 하나의 저장 코드. */
    public static List<String> storageCodes(EditAction action) {
        if ("nose.tip_height".equals(action.code())) {
            return List.of("nose.tip_height", "nose.tip_rotation");
        }
        if (action.code().startsWith("nose.") || action.code().startsWith("contour.")) {
            return List.of(action.code());
        }
        return switch (action.side()) {
            case "left", "right" -> List.of(action.code() + "." + action.side());
            default -> List.of(action.code() + ".left", action.code() + ".right");
        };
    }

    /**
     * 후보 → 슬라이더와 같은 요청값. 저장할 수 없는 코드가 하나라도 있으면 CON_010(부분 적용하지 않는다 — 미지원 구절은 AI가 이미 {@code
     * skipped[]}로 뺐다).
     *
     * @param current 현재 가중치(누락 = 0)
     * @param supported 이 시안 스키마의 활성 저장 코드
     */
    public static List<MorphEdits.Requested> requested(
            List<EditAction> actions, Map<String, Double> current, Set<String> supported) {
        return requested(actions, current, supported, Map.of());
    }

    static List<MorphEdits.Requested> requested(
            List<EditAction> actions,
            Map<String, Double> current,
            Set<String> supported,
            Map<String, com.preface.api.simulation.service.MorphRange> displayRanges) {
        if (actions == null || actions.isEmpty()) {
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE, "no actions");
        }
        Map<String, Double> running = new HashMap<>(current);
        Set<String> order = new LinkedHashSet<>();
        for (EditAction action : actions) {
            if (!isValid(action)
                    || (action.code().startsWith("nose.")
                            && !CHAT_NOSE_CODES.contains(action.code()))
                    || (action.code().startsWith("contour.")
                            && !CHAT_CONTOUR_CODES.contains(action.code()))) {
                throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE, "invalid action");
            }
            for (String code : storageCodes(action)) {
                if (!supported.contains(code)) {
                    throw new BusinessException(
                            ConsultErrorCode.NOT_APPLICABLE, "unsupported code: " + code);
                }
                double gain =
                        "nose.tip_height".equals(action.code())
                                ? ("nose.tip_height".equals(code) ? 0.6 : 0.4)
                                : 1.0;
                double delta =
                        Math.round(action.direction() * STEP.get(action.strength()) * gain * 1000)
                                / 1000.0;
                if (action.target() == null) {
                    running.put(code, running.getOrDefault(code, 0.0) + delta);
                } else {
                    double span =
                            "nose.tip_height".equals(action.code()) ? 1 : Double.POSITIVE_INFINITY;
                    for (String storage : storageCodes(action)) {
                        var range = displayRanges.get(storage);
                        double ratio =
                                "nose.tip_height".equals(action.code())
                                        ? ("nose.tip_height".equals(storage) ? -0.6 : -0.4)
                                        : 1;
                        if (range == null)
                            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
                        double extent = action.target() * ratio < 0 ? -range.min() : range.max();
                        if (action.target() != 0 && extent <= 0)
                            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
                        span = Math.min(span, extent / Math.abs(ratio));
                    }
                    boolean pairedTip = "nose.tip_height".equals(action.code());
                    double scaled = action.target() * span * (pairedTip ? -gain : gain);
                    // 직접 조절의 toFixed(3)처럼 이진 double 원값을 기준으로 반올림한다.
                    double rounded =
                            pairedTip
                                    ? new BigDecimal(scaled)
                                            .setScale(3, RoundingMode.HALF_UP)
                                            .doubleValue()
                                    : Math.round(scaled * 1000) / 1000.0;
                    running.put(code, rounded);
                }
                order.add(code);
            }
        }
        List<MorphEdits.Requested> requested = new ArrayList<>();
        for (String code : order) {
            requested.add(new MorphEdits.Requested(code, running.get(code)));
        }
        return requested;
    }

    /** 검색용 {@code change_request.part}. 한 부위면 EYE·NOSE·CONTOUR, 섞이면 null. */
    public static String part(List<EditAction> actions) {
        Set<String> parts = new LinkedHashSet<>();
        for (EditAction a : actions) {
            parts.add(
                    a.code().startsWith("eye.")
                            ? "EYE"
                            : a.code().startsWith("contour.") ? "CONTOUR" : "NOSE");
        }
        return parts.size() == 1 ? parts.iterator().next() : null;
    }

    /** "더"·"덜": 직전 성공 거래의 효과 전체를 작은 단계로 한 번 더(같은 방향) 또는 덜(반대 방향) 한다(consult-apply 계약 "더/덜"). */
    public static List<EditAction> adjust(List<EditAction> previous, boolean more) {
        return previous.stream()
                .map(
                        a ->
                                new EditAction(
                                        a.code(),
                                        a.side(),
                                        more ? a.direction() : -a.direction(),
                                        "small"))
                .toList();
    }
}
