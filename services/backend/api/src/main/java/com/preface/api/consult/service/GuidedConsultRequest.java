package com.preface.api.consult.service;

import com.preface.api.consult.dto.EditAction;
import java.util.regex.Pattern;

/** 안내 직후 부위를 생략한 한 문장만 읽는다. */
record GuidedConsultRequest(String verb, String strength) {
    private static final String PREFIX = "(?:(?:그럼|그러면)\\s*)?(?:(?:그거|이거|거기)(?:만|를)?\\s*)?";
    private static final Pattern DIRECTION =
            Pattern.compile(
                    PREFIX
                            + "(?:"
                            + SpringConsultClient.RELATIVE_STRENGTH
                            + ")?\\s*(?:더\\s*)?"
                            + "(올려|높여|내려|낮춰|넓혀|좁혀|늘려|줄여|키워|작게\\s*해|"
                            + "내밀어|넣어|길게\\s*해|짧게\\s*해|감량해|증량해)"
                            + "(?:\\s*(?:줘|주세요))?[.!\\s]*");
    private static final Pattern AMBIGUOUS =
            Pattern.compile(PREFIX + "(?:(?:조금만?|살짝|좀|그렇게)(?:\\s*해줘)?|좋아요|네)[.!?\\s]*");

    static GuidedConsultRequest parseDirect(String content) {
        return parse(content.replaceFirst("^(?:여기|이\\s*부분|이\\s*항목)(?:만|을|를)?\\s*", ""));
    }

    static GuidedConsultRequest parse(String content) {
        var match = DIRECTION.matcher(content);
        if (match.matches()) {
            return new GuidedConsultRequest(
                    match.group(1).replaceAll("\\s+", ""),
                    SpringConsultClient.contourStrength(content));
        }
        return AMBIGUOUS.matcher(content).matches() ? new GuidedConsultRequest(null, null) : null;
    }

    EditAction action(String code, String source) {
        if (verb == null) return null;
        int direction =
                switch (code) {
                    case "nose.bridge_height", "nose.tip_height", "eye.height" ->
                            sign("올려|높여", "내려|낮춰");
                    case "nose.tip_projection", "contour.chin_projection" -> sign("내밀어", "넣어");
                    case "nose.alar_width", "contour.chin_width" -> sign("넓혀|늘려", "좁혀|줄여");
                    case "eye.inner", "eye.outer", "eye.upper", "eye.lower" ->
                            sign("넓혀|늘려", "좁혀|줄여");
                    case "contour.cheekbone", "contour.cheek_volume", "contour.jaw_angle" ->
                            sign("키워|늘려", "작게해|줄여");
                    case "contour.chin_length" -> sign("길게해|늘려", "짧게해|줄여");
                    case "contour.weight_shape" -> sign("증량해", "감량해");
                    default -> 0;
                };
        return direction == 0 ? null : new EditAction(code, "both", direction, strength, source);
    }

    private int sign(String increase, String decrease) {
        if (verb.matches(increase)) return 1;
        if (verb.matches(decrease)) return -1;
        return 0;
    }
}
