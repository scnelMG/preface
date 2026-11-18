package com.preface.api.consult.service;

import com.preface.api.consult.dto.EditAction;
import com.preface.api.simulation.dto.EyeCapabilities;
import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.api.simulation.service.EyeEditService;
import com.preface.common.error.BusinessException;
import com.preface.common.error.ConsultErrorCode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** 화면의 눈 조절 후보를 같은 eyeEdit 상태로 바꾼다. 예전 eye morph code는 받지 않는다. */
final class EyeConsultEdits {
    static final String FOLD_OFF = "eye.style_none";
    private static final Pattern REMOVE_STYLE = Pattern.compile("없애|제거|지워|빼|풀어");
    private static final Pattern INCREASE = Pattern.compile("높여|올려|늘려|키워|넓혀|크게|강하게");
    private static final Pattern DECREASE = Pattern.compile("낮춰|내려|줄여|좁혀|작게|약하게|덜|없애|제거|지워|빼|풀어");
    static final Set<String> CODES =
            Set.of(
                    "eye.style_inline",
                    "eye.style_inout",
                    "eye.style_outline",
                    FOLD_OFF,
                    "eye.height",
                    "eye.inner",
                    "eye.outer",
                    "eye.upper",
                    "eye.lower");

    record Applied(
            EyeEditState state,
            boolean limited,
            List<String> changedCodes,
            List<String> unchangedCodes) {}

    private EyeConsultEdits() {}

    static EyeEditState stateOrInitial(EyeEditState state) {
        return state == null ? EyeEditState.initial() : state;
    }

    static EyeEditState restore(
            EyeEditState current,
            EyeEditState before,
            ConsultCorrection.Control target,
            boolean partial) {
        EyeEditState now = stateOrInitial(current);
        EyeEditState previous = stateOrInitial(before);
        return new EyeEditState(
                restoreEye(now.L(), previous.L(), target, partial),
                restoreEye(now.R(), previous.R(), target, partial));
    }

    private static EyeEditState.EyeSettings restoreEye(
            EyeEditState.EyeSettings now,
            EyeEditState.EyeSettings previous,
            ConsultCorrection.Control target,
            boolean partial) {
        if (target == ConsultCorrection.Control.FOLD) {
            return new EyeEditState.EyeSettings(
                    previous.enabled(), previous.style(),
                    withValue(now.values(), "height", previous.values().height()),
                            previous.curve());
        }
        String control = target.code.substring("eye.".length());
        double currentValue = value(now.values(), control);
        double next =
                ConsultCorrection.restored(
                        currentValue, value(previous.values(), control), partial);
        if (partial) next = Math.round(next * 2) / 2.0;
        if (currentValue == next) return now;
        return new EyeEditState.EyeSettings(
                now.enabled(),
                now.style(),
                withValue(now.values(), control, next),
                "height".equals(control)
                        ? partial ? EyeEditState.curve(next, now.style()) : previous.curve()
                        : now.curve());
    }

    static List<String> allowedCodes(EyeEditService.Support support, EyeEditState current) {
        if (support == null || support.review() == null || support.capabilities() == null)
            return List.of();
        EyeEditState state = current == null ? EyeEditState.initial() : current;
        Map<String, Double> limits = support.capabilities().limits();
        List<String> result = new ArrayList<>();
        if (("absent".equals(support.review().L()) && state.L().enabled())
                || ("absent".equals(support.review().R()) && state.R().enabled())) {
            result.add(FOLD_OFF);
        }
        for (String trim : List.of("inner", "outer", "upper", "lower")) {
            if (limit(limits, trim) > 0) result.add("eye." + trim);
        }
        for (String style : List.of("inline", "inout", "outline")) {
            if (hasAbsent(support.review()) && limit(limits, style + ":height") > 0)
                result.add("eye.style_" + style);
        }
        if (("absent".equals(support.review().L())
                        && state.L().enabled()
                        && limit(limits, state.L().style() + ":height") > 0)
                || ("absent".equals(support.review().R())
                        && state.R().enabled()
                        && limit(limits, state.R().style() + ":height") > 0)) {
            result.add("eye.height");
        }
        return result;
    }

    static Applied apply(
            EyeEditState current, List<EditAction> actions, EyeEditService.Support support) {
        if (actions == null
                || actions.isEmpty()
                || support == null
                || support.capabilities() == null) throw notApplicable();
        EyeEditState state = current == null ? EyeEditState.initial() : current;
        if (state.L() == null || state.R() == null) throw notApplicable();
        Set<String> allowed = Set.copyOf(allowedCodes(support, state));
        boolean limited = false;
        List<String> changed = new ArrayList<>();
        List<String> unchanged = new ArrayList<>();
        for (EditAction action : actions) {
            if (!ConsultEdits.isValid(action)
                    || !CODES.contains(action.code())
                    || !"both".equals(action.side())
                    || !sourceDirectionMatches(action.code(), action.direction(), action.source())
                    || !allowed.contains(action.code())) throw notApplicable();
            double fraction = ConsultEdits.STEP.get(action.strength());
            Double absoluteDelta = null;
            if (action.target() != null) {
                String control = action.code().substring("eye.".length());
                boolean height = "height".equals(control);
                var anchor =
                        !height || ("absent".equals(support.review().L()) && state.L().enabled())
                                ? state.L()
                                : state.R();
                double max =
                        limit(
                                support.capabilities().limits(),
                                height ? anchor.style() + ":height" : control);
                absoluteDelta =
                        Math.min(max, Math.round(action.target() * max * 2) / 2.0)
                                - value(anchor.values(), control);
            }
            EyeUpdate left =
                    update(
                            state.L(),
                            support.review().L(),
                            support.capabilities(),
                            action,
                            fraction,
                            absoluteDelta);
            EyeUpdate right =
                    update(
                            state.R(),
                            support.review().R(),
                            support.capabilities(),
                            action,
                            fraction,
                            absoluteDelta);
            limited |= left.limited() || right.limited();
            EyeEditState next = new EyeEditState(left.eye(), right.eye());
            (state.equals(next) ? unchanged : changed).add(action.code());
            state = next;
            allowed = Set.copyOf(allowedCodes(support, state));
        }
        return new Applied(state, limited, changed, unchanged);
    }

    static String summary(List<String> changedCodes) {
        if (changedCodes.size() != 1) return "눈 변경";
        return label(changedCodes.getFirst()) + " 변경";
    }

    static String label(String code) {
        return switch (code) {
            case "eye.style_inline", "eye.style_inout", "eye.style_outline", FOLD_OFF -> "쌍꺼풀 모양";
            case "eye.height" -> "쌍꺼풀 높이";
            case "eye.inner" -> "앞트임";
            case "eye.outer" -> "뒤트임";
            case "eye.upper" -> "윗트임";
            case "eye.lower" -> "밑트임";
            default -> throw notApplicable();
        };
    }

    static boolean sourceDirectionMatches(String code, int direction, String source) {
        if (FOLD_OFF.equals(code)) return direction == 1 && source != null && foldOff(source);
        if (code.startsWith("eye.style_")) {
            return direction == 1 && (source == null || !REMOVE_STYLE.matcher(source).find());
        }
        if (source == null) return true; // Older stored candidates have no source.
        boolean increase = INCREASE.matcher(source).find();
        boolean decrease = DECREASE.matcher(source).find();
        return increase != decrease ? direction == (increase ? 1 : -1) : !increase;
    }

    private record EyeUpdate(EyeEditState.EyeSettings eye, boolean limited) {}

    static boolean foldOff(String text) {
        return text.matches(
                "쌍꺼풀(?:을|은|만)?\\s*(?:(?:없애|꺼)\\s*(?:줘|주세요)|(?:제거|끄기)(?:\\s*해\\s*(?:줘|주세요))?|없음으로\\s*(?:바꿔|설정해)\\s*(?:줘|주세요))[.!\\s]*");
    }

    private static EyeUpdate update(
            EyeEditState.EyeSettings eye,
            String review,
            EyeCapabilities capabilities,
            EditAction action,
            double fraction,
            Double absoluteDelta) {
        String code = action.code();
        Map<String, Double> limits = capabilities.limits();
        if (code.startsWith("eye.style_")) {
            if (!"absent".equals(review)) return new EyeUpdate(eye, false);
            if (FOLD_OFF.equals(code)) {
                return new EyeUpdate(
                        new EyeEditState.EyeSettings(false, eye.style(), eye.values(), eye.curve()),
                        false);
            }
            String style = code.substring("eye.style_".length());
            double height = Math.min(eye.values().height(), limit(limits, style + ":height"));
            var values = withValue(eye.values(), "height", height);
            return new EyeUpdate(
                    new EyeEditState.EyeSettings(
                            true, style, values, EyeEditState.curve(height, style)),
                    height < eye.values().height());
        }
        String control = code.substring("eye.".length());
        if ("height".equals(control) && (!"absent".equals(review) || !eye.enabled()))
            return new EyeUpdate(eye, false);
        double max = limit(limits, "height".equals(control) ? eye.style() + ":height" : control);
        double before = value(eye.values(), control);
        double requested =
                before
                        + (absoluteDelta == null
                                ? action.direction() * Math.max(1, Math.round(fraction * max))
                                : absoluteDelta);
        double after = Math.max(0, Math.min(max, requested));
        var values = withValue(eye.values(), control, after);
        return new EyeUpdate(
                new EyeEditState.EyeSettings(
                        eye.enabled(),
                        eye.style(),
                        values,
                        "height".equals(control)
                                ? EyeEditState.curve(after, eye.style())
                                : eye.curve()),
                after != requested);
    }

    private static double value(EyeEditState.Values values, String control) {
        return switch (control) {
            case "height" -> values.height();
            case "inner" -> values.inner();
            case "outer" -> values.outer();
            case "upper" -> values.upper();
            case "lower" -> values.lower();
            default -> throw notApplicable();
        };
    }

    private static EyeEditState.Values withValue(
            EyeEditState.Values values, String control, double value) {
        return new EyeEditState.Values(
                "height".equals(control) ? value : values.height(),
                values.crease(),
                "inner".equals(control) ? value : values.inner(),
                "outer".equals(control) ? value : values.outer(),
                "lower".equals(control) ? value : values.lower(),
                "upper".equals(control) ? value : values.upper());
    }

    private static boolean hasAbsent(EyeReview review) {
        return "absent".equals(review.L()) || "absent".equals(review.R());
    }

    private static double limit(Map<String, Double> limits, String key) {
        Double value = limits.get(key);
        return value == null || !Double.isFinite(value) ? 0 : value;
    }

    private static BusinessException notApplicable() {
        return new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
    }
}
