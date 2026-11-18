package com.preface.api.consult.service;

import com.preface.api.consult.dto.EditAction;
import com.preface.api.simulation.dto.MorphState;
import com.preface.api.simulation.service.MorphEdits;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** 상담 정정은 알려진 조절 이름과 적용 이력에만 결속한다. */
final class ConsultCorrection {
    enum Control {
        BRIDGE("nose.bridge_height", "콧대 높이", "콧대"),
        TIP_VERTICAL("nose.tip_height", "코끝 위아래"),
        TIP_PROJECTION("nose.tip_projection", "코끝 앞뒤"),
        ALAR("nose.alar_width", "콧볼 너비", "콧볼"),
        CHEEKBONE("contour.cheekbone", "광대 크기", "광대"),
        CHEEK("contour.cheek_volume", "볼살"),
        CHIN_PROJECTION("contour.chin_projection", "턱끝 앞뒤"),
        CHIN_LENGTH("contour.chin_length", "턱끝 길이"),
        CHIN_WIDTH("contour.chin_width", "턱끝 폭"),
        JAW("contour.jaw_angle", "사각턱", "턱선"),
        WEIGHT("contour.weight_shape", "체중 변화"),
        INNER("eye.inner", "앞트임"),
        OUTER("eye.outer", "뒤트임"),
        UPPER("eye.upper", "윗트임"),
        LOWER("eye.lower", "밑트임"),
        HEIGHT("eye.height", "쌍꺼풀 높이"),
        FOLD("eye.style", "쌍꺼풀 모양", "쌍꺼풀");

        final String code;
        final String label;
        final List<String> names;

        Control(String code, String label, String... aliases) {
            this.code = code;
            this.label = label;
            this.names =
                    java.util.stream.Stream.concat(
                                    java.util.stream.Stream.of(label),
                                    java.util.Arrays.stream(aliases))
                            .toList();
        }

        boolean eye() {
            return code.startsWith("eye.");
        }

        List<String> storageCodes() {
            return this == TIP_VERTICAL ? List.of(code, "nose.tip_rotation") : List.of(code);
        }

        EditAction action() {
            return new EditAction(this == FOLD ? "eye.style_inout" : code, "both", 1, "small");
        }
    }

    private static final String NAME =
            java.util.Arrays.stream(Control.values())
                    .flatMap(control -> control.names.stream())
                    .collect(Collectors.joining("|", "(?:", "|코끝|턱끝)"));
    private static final Pattern NAMED =
            Pattern.compile(
                    "(?:("
                            + NAME
                            + ")(?:는|은)\\s*그대로\\s*(?:두고|유지하고)[,\\s]+)?"
                            + "(?:(?:아까|방금|이전에)\\s*(?:바꾼|조절한)?\\s*)?"
                            + "("
                            + NAME
                            + ")(?:만|을|를)?\\s*(?:원래대로\\s*)?"
                            + "(?:되돌려|돌려|복원해|취소해)\\s*(?:줘|주세요)[.!\\s]*");
    private static final Pattern AMBIGUOUS =
            Pattern.compile(
                    "(?:아까|방금)\\s*(?:바꾼\\s*)?(?:거|것)(?:을|만)?\\s*"
                            + "(?:(되돌려|돌려|취소해)|(?:조금|좀|약간)만?\\s*(?:줄여|덜\\s*해|약하게\\s*해))"
                            + "\\s*(?:줘|주세요)[.!\\s]*");

    record Intent(List<Control> targets, boolean partial) {}

    /** EDIT-05가 최신 화면 버전을 보내더라도 상담 당시 버전이 달라졌으면 정정하지 않는다. */
    record Selection(Control control, int stateVersion, boolean partial) {}

    record Target(Control control, MorphState before) {
        List<MorphEdits.Requested> weights(MorphState current, boolean partial) {
            return control.eye()
                    ? List.of()
                    : control.storageCodes().stream()
                            .map(
                                    code ->
                                            new MorphEdits.Requested(
                                                    code,
                                                    restored(
                                                            weight(current, code),
                                                            weight(before, code),
                                                            partial)))
                            .toList();
        }
    }

    private ConsultCorrection() {}

    static Optional<Intent> parse(String text) {
        var named = NAMED.matcher(text);
        if (named.matches()) {
            List<Control> kept = matching(named.group(1));
            return Optional.of(
                    new Intent(
                            matching(named.group(2)).stream()
                                    .filter(control -> !kept.contains(control))
                                    .toList(),
                            false));
        }
        var ambiguous = AMBIGUOUS.matcher(text);
        return ambiguous.matches()
                ? Optional.of(new Intent(List.of(Control.values()), ambiguous.group(1) == null))
                : Optional.empty();
    }

    private static List<Control> matching(String name) {
        if (name == null) return List.of();
        return java.util.Arrays.stream(Control.values())
                .filter(
                        control ->
                                control.names.contains(name)
                                        || ("코끝".equals(name) && control.label.startsWith("코끝 "))
                                        || ("턱끝".equals(name) && control.label.startsWith("턱끝 ")))
                .toList();
    }

    static boolean changed(Control control, MorphState before, MorphState after) {
        if (control.eye()) {
            var now = EyeConsultEdits.stateOrInitial(after.eyeEdit());
            var previous = EyeConsultEdits.stateOrInitial(before.eyeEdit());
            return (control == Control.HEIGHT
                            && (foldModeChanged(previous.L(), now.L())
                                    || foldModeChanged(previous.R(), now.R())))
                    || !EyeConsultEdits.restore(now, previous, control, false).equals(now);
        }
        return control.storageCodes().stream()
                .anyMatch(code -> weight(before, code) != weight(after, code));
    }

    private static boolean foldModeChanged(
            com.preface.api.simulation.dto.EyeEditState.EyeSettings before,
            com.preface.api.simulation.dto.EyeEditState.EyeSettings after) {
        return before.enabled() != after.enabled() || !before.style().equals(after.style());
    }

    static double restored(double current, double previous, boolean partial) {
        return partial ? current + (previous - current) * 0.25 : previous;
    }

    private static double weight(MorphState state, String code) {
        return state.weights().getOrDefault(code, 0.0);
    }
}
