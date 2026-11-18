package com.preface.api.consult.service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

final class NextAdjustmentEvidence {

    private static final String PROFILE = "upper-lip-profile-line";
    private static final String PROFILE_SOURCE = "ricketts-profile";
    private static final String FRONT_SOURCE = "facebase-surface-landmarks";
    private static final String PROFILE_EVIDENCE = "Ricketts는 코끝과 턱끝을 잇는 선을 기준으로 입술의 옆모습 위치를 설명했다.";
    private static final String PROFILE_LIMIT =
            "앱은 선 길이로 정규화한 상대 위치를 비교한다. 코끝이나 턱끝이 움직이면 선도 바뀐다. "
                    + "입술 자체의 이동, 실제 거리, 이상적인 위치를 추론하지 않는다.";
    private static final Pattern SPOKEN_RATIO =
            Pattern.compile("[일이삼사오육칠팔구십백천]+ *분의|절반|퍼센트|프로(?:예요|입니다|정도|쯤)|할(?:가량|쯤|이에요)");

    record Evidence(
            String candidateId,
            String metricId,
            String evidenceId,
            String label,
            String region,
            String angle,
            String description,
            String interpretationLimit) {}

    record Selection(String candidateId, String metricId, String evidenceId) {}

    record Result(List<Selection> selections) {}

    record Trial(
            Evidence evidence,
            String direction,
            double before,
            double after,
            String action,
            String appearanceBefore,
            String measuredChange) {}

    record MeasuredSelection(
            String candidateId,
            String metricId,
            String evidenceId,
            String direction,
            String explanation) {}

    record MeasuredResult(List<MeasuredSelection> selections) {}

    record MeasuredAdvice(Trial trial, String explanation) {}

    static List<Trial> trials(List<Evidence> evidence, Map<String, Double> measurements) {
        var trials = new ArrayList<Trial>();
        for (var card : evidence) {
            Double before = measurements.get(card.metricId());
            if (!validRatio(card.metricId(), before)) continue;
            for (String direction : List.of("down", "up")) {
                Double after = measurements.get(card.candidateId() + ":" + direction);
                if (validRatio(card.metricId(), after)
                        && after.doubleValue() != before.doubleValue())
                    trials.add(
                            new Trial(
                                    card,
                                    direction,
                                    before,
                                    after,
                                    action(card.candidateId(), direction),
                                    appearanceBefore(card.metricId(), before),
                                    measuredChange(card.metricId(), before, after)));
            }
        }
        return List.copyOf(trials);
    }

    private static String appearanceBefore(String metric, double before) {
        if (PROFILE.equals(metric)) {
            if (before == 0) return "윗입술이 코끝과 턱끝을 이은 선에 닿아 있다";
            return "윗입술이 코끝과 턱끝을 이은 선보다 " + (before < 0 ? "뒤" : "앞") + "에 있다";
        }
        String comparison = before < 1 ? "보다 작다" : before > 1 ? "보다 크다" : "과 같다";
        return switch (metric) {
            case "jaw-width-face-width" -> "정면의 아래턱 양옆 폭이 얼굴 양옆 폭" + comparison;
            case "eye-to-chin-face-width" -> "정면의 눈 높이부터 턱끝까지의 세로 길이가 얼굴 양옆 폭" + comparison;
            case "intercanthal-outer-eye-width" -> "정면의 눈머리 사이 너비가 양쪽 눈꼬리 사이 너비" + comparison;
            default -> throw new IllegalArgumentException("Unknown recommendation metric");
        };
    }

    private static String measuredChange(String metric, double before, double after) {
        if (PROFILE.equals(metric)) {
            if (after == 0) return "입술이 코끝과 턱끝을 이은 선과 같은 위치에 놓였다";
            if (before != 0 && Math.signum(before) != Math.signum(after)) {
                return "코끝과 턱끝을 이은 선의 " + (after > 0 ? "앞" : "뒤") + "쪽에 입술이 놓이도록 두 위치의 관계가 바뀌었다";
            }
            return "코끝과 턱끝을 이은 선 길이 대비 윗입술이 선에서 떨어진 정도가 "
                    + (Math.abs(after) < Math.abs(before) ? "줄었다" : "늘었다");
        }
        String ratio =
                switch (metric) {
                    case "jaw-width-face-width" -> "얼굴 너비 대비 아래턱 폭의 비율";
                    case "eye-to-chin-face-width" -> "얼굴 너비 대비 눈 높이에서 턱끝까지의 길이 비율";
                    case "intercanthal-outer-eye-width" -> "눈 바깥 모서리 사이 너비 대비 눈머리 간격의 비율";
                    default -> throw new IllegalArgumentException("Unknown recommendation metric");
                };
        return ratio + (after < before ? "이 줄었다" : "이 늘었다");
    }

    private static String action(String candidate, String direction) {
        boolean increase = "up".equals(direction);
        return switch (candidate) {
            case "jawAngle" -> "사각턱 폭을 살짝 " + (increase ? "넓혀" : "좁혀");
            case "chinLength" -> "턱끝을 살짝 " + (increase ? "길게" : "짧게");
            case "eyeInner" -> "앞트임을 살짝 " + (increase ? "늘려" : "줄여");
            case "projection", "chinProjection" ->
                    (candidate.equals("projection") ? "코끝을" : "턱끝을")
                            + " 살짝 "
                            + (increase ? "앞으로" : "뒤로");
            default -> throw new IllegalArgumentException("Unknown recommendation candidate");
        };
    }

    private static boolean validRatio(String metric, Double value) {
        return value != null
                && Double.isFinite(value)
                && (PROFILE.equals(metric) ? Math.abs(value) <= 1 : value > 0 && value <= 2);
    }

    static List<MeasuredAdvice> validateMeasured(MeasuredResult result, List<Trial> trials) {
        if (result == null || result.selections() == null || result.selections().size() > 3)
            return List.of();
        var used = new HashSet<String>();
        var advice = new ArrayList<MeasuredAdvice>();
        for (var selection : result.selections()) {
            if (selection == null || selection.explanation() == null) continue;
            String explanation = selection.explanation().strip();
            String[] sentences = explanation.split("[.!?]+\\s*");
            if (explanation.isEmpty()
                    || explanation.length() > 140
                    || sentences.length != 2
                    || SPOKEN_RATIO.matcher(explanation).find()
                    || sentences[0].contains("상당 부분")
                    || sentences[1].matches(".*(?:는지|어떻게)\\s*.{0,12}(?:확인|비교|살펴).*")
                    || explanation.matches("(?s).*[/<>&A-Za-z\\p{Cntrl}\\d].*")
                    || explanation.matches("(?s).*(?:수술|시술|진단|처방|황금비|정상|비정상|치료|완벽|기준선).*"))
                continue;
            trials.stream()
                    .filter(
                            trial ->
                                    trial.evidence().candidateId().equals(selection.candidateId())
                                            && trial.evidence()
                                                    .metricId()
                                                    .equals(selection.metricId())
                                            && trial.evidence()
                                                    .evidenceId()
                                                    .equals(selection.evidenceId())
                                            && trial.direction().equals(selection.direction())
                                            && sentences[1].contains(trial.action()))
                    .findFirst()
                    .filter(trial -> used.add(trial.evidence().region()))
                    .ifPresent(trial -> advice.add(new MeasuredAdvice(trial, explanation)));
        }
        return List.copyOf(advice);
    }

    static List<MeasuredAdvice> completeMeasured(
            List<MeasuredAdvice> selected, List<Trial> trials) {
        if (selected.size() >= 2) return selected;
        var completed = new ArrayList<>(selected);
        var regions = new HashSet<String>();
        selected.forEach(advice -> regions.add(advice.trial().evidence().region()));
        for (var trial : trials) {
            if (!regions.add(trial.evidence().region())) continue;
            String explanation =
                    "현재 시안에서는 %s고 확인했어요. %s 조절했을 때는 %s고 측정됐어요."
                            .formatted(
                                    trial.appearanceBefore(),
                                    trial.action(),
                                    trial.measuredChange());
            completed.add(new MeasuredAdvice(trial, explanation));
            if (completed.size() == 2) break;
        }
        return List.copyOf(completed);
    }

    private record Candidate(String sliderCode, Evidence evidence) {}

    private static final Map<String, Candidate> CANDIDATES =
            Map.of(
                    "chinProjection",
                            new Candidate(
                                    "contour.chin_projection",
                                    new Evidence(
                                            "chinProjection",
                                            PROFILE,
                                            PROFILE_SOURCE,
                                            "턱끝 앞뒤",
                                            "윤곽",
                                            "옆모습",
                                            PROFILE_EVIDENCE,
                                            PROFILE_LIMIT)),
                    "projection",
                            new Candidate(
                                    "nose.tip_projection",
                                    new Evidence(
                                            "projection",
                                            PROFILE,
                                            PROFILE_SOURCE,
                                            "코끝 앞뒤",
                                            "코",
                                            "옆모습",
                                            PROFILE_EVIDENCE,
                                            PROFILE_LIMIT)),
                    "jawAngle",
                            new Candidate(
                                    "contour.jaw_angle",
                                    new Evidence(
                                            "jawAngle",
                                            "jaw-width-face-width",
                                            FRONT_SOURCE,
                                            "사각턱",
                                            "윤곽",
                                            "정면",
                                            "FaceBase는 3D 얼굴 표면만 보고 뼈의 턱각 기준점을 일관되게 찾기 어렵다고 설명한다.",
                                            "앱의 아래턱 폭은 정면 피부 윤곽의 상대 너비다. 뼈의 턱각, 교근, 얼굴형의 정상 범위를 뜻하지 않는다.")),
                    "chinLength",
                            new Candidate(
                                    "contour.chin_length",
                                    new Evidence(
                                            "chinLength",
                                            "eye-to-chin-face-width",
                                            FRONT_SOURCE,
                                            "턱끝 길이",
                                            "윤곽",
                                            "정면",
                                            "FaceBase는 눈 바깥 모서리와 턱 아래쪽 중앙의 얼굴 표면 기준점을 정의한다.",
                                            "앱은 눈 높이에서 턱끝까지의 길이를 얼굴 폭과 비교한다. 얼굴 전체 높이, 턱뼈 길이, 인중 길이로 해석하지 않는다.")),
                    "eyeInner",
                            new Candidate(
                                    "eye.inner",
                                    new Evidence(
                                            "eyeInner",
                                            "intercanthal-outer-eye-width",
                                            FRONT_SOURCE,
                                            "앞트임",
                                            "눈",
                                            "정면",
                                            "FaceBase는 위아래 눈꺼풀이 만나는 눈 안쪽과 바깥쪽 모서리를 표면 기준점으로 정의한다.",
                                            "앱은 양쪽 눈머리 사이의 상대 너비를 비교한다. 안구 크기, 눈이 열린 면적, 시야, 수술 효과를 추론하지 않는다.")));

    private NextAdjustmentEvidence() {}

    static List<Evidence> retrieve(String section, AiConsult.Request request) {
        return Arrays.stream(section.split(":")[1].split(","))
                .distinct()
                .map(CANDIDATES::get)
                .filter(
                        candidate ->
                                candidate != null
                                        && SpringConsultClient.guidanceOpen(
                                                candidate.sliderCode(),
                                                request.allowedCodes(),
                                                request.morphState()))
                .map(Candidate::evidence)
                .toList();
    }

    static List<String> validate(Result result, List<Evidence> evidence, boolean analysis) {
        if (result == null || result.selections() == null || result.selections().size() > 3)
            return List.of();
        var used = new HashSet<String>();
        var selected = new ArrayList<String>();
        for (var selection : result.selections()) {
            if (selection == null) continue;
            var match =
                    evidence.stream()
                            .filter(
                                    card ->
                                            card.candidateId().equals(selection.candidateId())
                                                    && card.metricId().equals(selection.metricId())
                                                    && card.evidenceId()
                                                            .equals(selection.evidenceId()))
                            .findFirst();
            match.filter(card -> used.add(analysis ? card.candidateId() : card.region()))
                    .ifPresent(card -> selected.add(card.candidateId()));
        }
        return List.copyOf(selected);
    }
}
