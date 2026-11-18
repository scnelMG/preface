package com.preface.api.consult.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** 상담에서 편집 없이 설명할 수 있는 직접 조절 항목. */
record ConsultGuidance(String label, String explanation, String example) {
    private static final List<Map.Entry<String, ConsultGuidance>> CONTROL_ENTRIES =
            List.of(
                    guide("nose.bridge_height", "콧대 높이", "콧대를 높이거나 낮출 수 있어요.", "콧대를 조금 높여줘"),
                    guide(
                            "nose.tip_projection",
                            "코끝 앞뒤",
                            "코끝을 앞으로 내밀거나 뒤로 넣을 수 있어요.",
                            "코끝을 앞으로 조금 내밀어줘"),
                    guide("nose.tip_height", "코끝 위아래", "코끝을 올리거나 내릴 수 있어요.", "코끝을 조금 올려줘"),
                    guide("nose.alar_width", "콧볼 너비", "콧볼을 넓히거나 좁힐 수 있어요.", "콧볼을 조금 좁혀줘"),
                    guide("eye.inner", "앞트임", "눈 앞쪽 트임을 늘리거나 줄일 수 있어요.", "앞트임을 조금 넓혀줘"),
                    guide("eye.outer", "뒤트임", "눈 바깥쪽 트임을 늘리거나 줄일 수 있어요.", "뒤트임을 조금 넓혀줘"),
                    guide("eye.upper", "윗트임", "눈 위쪽 트임을 늘리거나 줄일 수 있어요.", "윗트임을 조금 넓혀줘"),
                    guide("eye.lower", "밑트임", "눈 아래쪽 트임을 늘리거나 줄일 수 있어요.", "밑트임을 조금 넓혀줘"),
                    guide("eye.height", "쌍꺼풀 높이", "쌍꺼풀 높이를 올리거나 내릴 수 있어요.", "쌍꺼풀 높이를 조금 올려줘"),
                    guide("eye.style_none", "쌍꺼풀 없음", "추가한 쌍꺼풀을 끌 수 있어요.", "쌍꺼풀을 없애줘"),
                    guide("eye.style_inline", "인라인", "쌍꺼풀 모양을 인라인으로 바꿀 수 있어요.", "인라인 쌍꺼풀로 바꿔줘"),
                    guide("eye.style_inout", "인아웃", "쌍꺼풀 모양을 인아웃으로 바꿀 수 있어요.", "인아웃 쌍꺼풀로 바꿔줘"),
                    guide("eye.style_outline", "아웃라인", "쌍꺼풀 모양을 아웃라인으로 바꿀 수 있어요.", "아웃라인 쌍꺼풀로 바꿔줘"),
                    guide("contour.cheekbone", "광대 크기", "광대가 도드라지는 정도를 조절할 수 있어요.", "광대를 조금 줄여줘"),
                    guide("contour.cheek_volume", "볼살", "볼을 도톰하게 하거나 볼륨을 줄일 수 있어요.", "볼살을 조금 줄여줘"),
                    guide(
                            "contour.chin_projection",
                            "턱끝 앞뒤",
                            "턱끝을 앞으로 내밀거나 뒤로 넣을 수 있어요.",
                            "턱끝을 앞으로 조금 내밀어줘"),
                    guide(
                            "contour.chin_length",
                            "턱끝 길이",
                            "턱끝을 길게 또는 짧게 조절할 수 있어요.",
                            "턱끝 길이를 조금 줄여줘"),
                    guide("contour.chin_width", "턱끝 폭", "턱끝을 넓히거나 좁힐 수 있어요.", "턱끝 폭을 조금 좁혀줘"),
                    guide("contour.jaw_angle", "사각턱", "사각턱이 도드라지는 정도를 조절할 수 있어요.", "사각턱을 조금 줄여줘"),
                    guide(
                            "contour.weight_shape",
                            "체중 변화",
                            "감량 또는 증량 방향으로 얼굴 변화를 미리 볼 수 있어요.",
                            "체중 변화를 감량 방향으로 조금 조절해줘"));

    private static final Map<String, ConsultGuidance> CONTROLS = new LinkedHashMap<>();

    static {
        CONTROL_ENTRIES.forEach(entry -> CONTROLS.put(entry.getKey(), entry.getValue()));
    }

    static List<String> codes() {
        return List.copyOf(CONTROLS.keySet());
    }

    static final String UNCHANGED = "얼굴은 바꾸지 않았어요.";
    static final String UNAVAILABLE = "현재 시안에서는 해당 조절을 할 수 없어요. " + UNCHANGED;

    static ConsultGuidance forCode(String code) {
        return code == null ? null : CONTROLS.get(code);
    }

    static String codeForLabel(String label) {
        return CONTROLS.entrySet().stream()
                .filter(entry -> entry.getValue().label().equals(label))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElse(null);
    }

    static String labels(List<String> codes) {
        return codes.stream().map(code -> forCode(code).label()).collect(Collectors.joining("·"));
    }

    String answer() {
        return explanation + " ‘" + example + "’처럼 말씀해 주세요. " + UNCHANGED;
    }

    private static Map.Entry<String, ConsultGuidance> guide(
            String code, String label, String explanation, String example) {
        return Map.entry(code, new ConsultGuidance(label, explanation, example));
    }
}
