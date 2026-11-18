package com.preface.api.consult.service;

import com.preface.api.consult.dto.EditAction;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** 슬라이더 표시값을 읽는다. 범위는 적용 시점의 승인값으로 환산한다. */
final class SliderConsultRequest {
    private static final Pattern FOLLOW_UP_PREFIX = Pattern.compile("^(?:그럼|그러면)\\s+");
    private static final Pattern SEPARATOR =
            Pattern.compile(
                    "[,，]\\s*|\\.\\s+|\\s+그리고\\s+|(?<=맞추고|설정하고|바꾸고)\\s+(?!다른\\s*부위)"
                            + "|(?<=그대로 두고|유지하고)\\s+");
    private static final Pattern KEEP =
            Pattern.compile(
                    "^(?<label>[가-힣 ]+?)\\s*(?:그대로(?:\\s*(?:두고|둬|둬요|두세요|둬\\s*(?:줘|주세요)))?"
                            + "|유지(?:하고|해(?:\\s*(?:줘|주세요))?))\\s*[.!]*$");
    private static final Pattern VALUE =
            Pattern.compile(
                    "^(?<label>[가-힣 ]+?)(?:을|를|은|는)?\\s*(?<value>[+-]?\\d+(?:\\.\\d+)?)\\s*"
                            + "(?<unit>%|퍼센트)?\\s*(?:으로|로)\\s*"
                            + "(?:(?:설정해|맞춰|바꿔)(?:\\s*(?:줘|주세요))?"
                            + "|(?:설정하고|맞추고|바꾸고)\\s+다른\\s*부위는\\s*그대로\\s*"
                            + "(?:둬(?:\\s*(?:줘|주세요))?|두세요))[.!\\s]*$");
    private static final Map<String, String> CODES =
            Map.ofEntries(
                    Map.entry("콧대높이", "nose.bridge_height"),
                    Map.entry("코끝앞뒤", "nose.tip_projection"),
                    Map.entry("코끝위아래", "nose.tip_height"),
                    Map.entry("콧볼너비", "nose.alar_width"),
                    Map.entry("쌍꺼풀높이", "eye.height"),
                    Map.entry("앞트임", "eye.inner"),
                    Map.entry("뒤트임", "eye.outer"),
                    Map.entry("윗트임", "eye.upper"),
                    Map.entry("밑트임", "eye.lower"),
                    Map.entry("광대", "contour.cheekbone"),
                    Map.entry("광대크기", "contour.cheekbone"),
                    Map.entry("볼살", "contour.cheek_volume"),
                    Map.entry("턱끝앞뒤", "contour.chin_projection"),
                    Map.entry("턱끝길이", "contour.chin_length"),
                    Map.entry("턱끝폭", "contour.chin_width"),
                    Map.entry("사각턱", "contour.jaw_angle"),
                    Map.entry("체중변화강도", "contour.weight_shape"));

    private SliderConsultRequest() {}

    static List<EditAction> parseAll(String text) {
        var single = parse(text);
        if (single != null) return List.of(single);
        String[] clauses = SEPARATOR.split(text);
        if (clauses.length < 2 || clauses.length > CODES.size()) return List.of();
        var edits = new ArrayList<String>();
        var preserved = new HashSet<String>();
        for (String clause : clauses) {
            String source = clause.strip();
            var keep = KEEP.matcher(source);
            if (!keep.matches()) {
                edits.add(source);
                continue;
            }
            String label = keep.group("label").replace(" ", "").replaceFirst("[을를은는]$", "");
            switch (label) {
                case "콧대" -> preserved.add("nose.bridge_height");
                case "콧볼" -> preserved.add("nose.alar_width");
                case "코끝" -> {
                    preserved.add("nose.tip_projection");
                    preserved.add("nose.tip_height");
                }
                default -> {
                    String code = CODES.get(label);
                    if (code == null) return List.of();
                    preserved.add(code);
                }
            }
        }
        var actions = new ArrayList<EditAction>();
        var codes = new HashSet<String>();
        for (int i = 0; i < edits.size(); i++) {
            String source = edits.get(i);
            var action =
                    parse(
                            source.replaceFirst("맞추고$", "맞춰줘")
                                    .replaceFirst("설정하고$", "설정해줘")
                                    .replaceFirst("바꾸고$", "바꿔줘"));
            if (action == null && i < edits.size() - 1) {
                String valueClause = source.replaceFirst("\\s*(?:으로|로)$", "");
                if (valueClause.matches("[가-힣 ]+?[+-]?\\d+(?:\\.\\d+)?\\s*(?:%|퍼센트)?"))
                    action = parse(valueClause + "로 맞춰줘");
            }
            if (action == null || preserved.contains(action.code()) || !codes.add(action.code()))
                return List.of();
            actions.add(
                    new EditAction(
                            action.code(),
                            action.side(),
                            action.direction(),
                            action.strength(),
                            source,
                            action.target()));
        }
        return actions;
    }

    static EditAction parse(String text) {
        var match = VALUE.matcher(FOLLOW_UP_PREFIX.matcher(text).replaceFirst(""));
        if (!match.matches()) return null;
        String label = match.group("label").replace(" ", "").replaceFirst("정확히$", "");
        String code = CODES.getOrDefault(label, CODES.get(label.replaceFirst("[을를은는만]$", "")));
        if (code == null) return null;
        boolean weight = code.equals("contour.weight_shape");
        if (weight && match.group("unit") != null) return null;
        double value = Double.parseDouble(match.group("value"));
        return new EditAction(code, "both", value < 0 ? -1 : 1, "small", text, value / 100.0);
    }
}
