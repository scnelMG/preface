package com.preface.api.consult.service;

import com.preface.api.facemodel.dto.BaselineMeasurementResponse;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse.Observation;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;
import java.util.regex.Pattern;

/** 원본 3D의 검수된 거리로만 비교한다. 문헌의 선호도는 개인 평가에 사용하지 않는다. */
final class FaceRatioConsultation {
    static final String PRIVATE_MEASUREMENT_LABEL = "콧볼 너비 ÷ 눈 안쪽 간격:";
    private static final Pattern ANALYSIS =
            Pattern.compile(
                    "(?:얼굴|안면).{0,20}(?:분석|비율)|(?:얼굴|안면).{0,18}(?:어때|어떤\\s*편|균형)|"
                            + "(?:콧볼|눈\\s*안쪽|내안각).{0,24}(?:거리|너비|간격|비율|편인가)|"
                            + "(?:옆모습|측면|눈과\\s*코|눈·코|눈|코).{0,12}(?:비율|균형|분석)|"
                            + "(?:입술|입매|입이|인중|하안부|턱(?:끝|선)?).{0,20}(?:비율|얇은\\s*편|두꺼운\\s*편|길어요|긴\\s*편|큰\\s*편|작은\\s*편|균형)");
    private static final Pattern EDIT =
            Pattern.compile(
                    "바꿔|바꾸|줄여|줄이|늘려|늘리|올려|올리|내려|내리|높여|높이(?:고|어|자)|낮춰|낮추|좁혀|좁히|넓혀|넓히|조절|적용|맞춰|수정|되돌|초기화|\\d\\s*(?:%|으로|로)");
    private static final Pattern COMPARE_PREVIEW =
            Pattern.compile("비교\\s*(?:하고\\s*싶|해\\s*(?:보고\\s*싶|볼래|줘|주세요))");
    private static final Pattern LIPS = Pattern.compile("입술|입매|입꼬리|입이|트렌디\\s*볼륨|클래식\\s*황금비율");
    private static final Pattern GOLDEN = Pattern.compile("황금\\s*비율|황금비");
    private static final Pattern LOWER_FACE =
            Pattern.compile("인중|하안부|턱(?:끝|선)?\\s*(?:의\\s*)?비율|턱(?:끝|선)?.{0,6}긴\\s*편");
    private static final Pattern EYE_INNER = Pattern.compile("눈\\s*안쪽|내안각");
    private static final String LIP_STUDIES =
            " 출처: https://pubmed.ncbi.nlm.nih.gov/28318919/, https://pubmed.ncbi.nlm.nih.gov/35666164/";
    private static final String LANDMARK_SOURCE =
            " 출처: https://www.facebase.org/resources/human/facial_norms/notes/";

    private FaceRatioConsultation() {}

    static boolean isQuestion(String text) {
        return !EDIT.matcher(text).find()
                && !(COMPARE_PREVIEW.matcher(text).find()
                        && text.contains("콧볼")
                        && !needsMeasurements(text))
                && (ANALYSIS.matcher(text).find()
                        || GOLDEN.matcher(text).find()
                        || text.matches(".*(?:트렌디\\s*볼륨|클래식\\s*황금비율).*"));
    }

    static boolean needsMeasurements(String text) {
        return text.contains("콧볼") && EYE_INNER.matcher(text).find();
    }

    static boolean hasFixedEvidenceQuestion(String text) {
        return GOLDEN.matcher(text).find() || text.contains("트렌디") || needsMeasurements(text);
    }

    static String profileSection(String text) {
        if (hasFixedEvidenceQuestion(text)) return null;
        if (text.matches("(?s).*(?:옆모습|측면).*")) return "side";
        if (LIPS.matcher(text).find()) return "lips";
        if (LOWER_FACE.matcher(text).find()) return "lower";
        if (text.matches("(?s).*(?:콧볼|눈\\s*안쪽|내안각|(?:눈|코).{0,12}(?:비율|균형|분석)).*")) return "eyes";
        return "overall";
    }

    static String answer(String question, BaselineMeasurementResponse measurements) {
        if (LIPS.matcher(question).find()) {
            if (question.contains("큰 편") || question.contains("작은 편")) {
                return "입의 가로 너비와 입술 두께는 다른 항목이에요. 이 시안에는 양쪽 입꼬리나 입술 높이의 검수값이 없어 입이 크거나 작은 편인지 비교하기 어려워요.";
            }
            return "입술 비율은 정면에서 보이는 윗입술과 아랫입술의 붉은 부분 높이를 비교할 수 있어요. 높이 비율과 입술 전체의 볼륨은 달라요.\n\n"
                    + "여성 모델 한 명의 이미지를 변형한 35개국 설문(1,011명 응답)에서는 윗입술:아랫입술 1:1이, 변형 이미지를 평가한 별도 연구(59명)에서는 1:1.6이 가장 높은 평가를 받았어요. 조사 조건에 따라 나온 선호도라 개인을 평가하는 기준으로 쓰지 않아요.\n\n"
                    + "지금 시안에는 검수된 입술 측정값이 없어 어느 쪽에 가까운지 말씀드리기 어려워요."
                    + LIP_STUDIES;
        }
        if (GOLDEN.matcher(question).find()) {
            return "얼굴에서 두 길이의 비율은 재 볼 수 있지만, 1:1.618을 미적 기준이나 시술 목표로 삼을 근거는 충분하지 않아요. ‘내 얼굴 비율 분석’으로 확인 가능한 실제 측정 항목을 볼 수 있어요."
                    + " 출처: https://pubmed.ncbi.nlm.nih.gov/38228978/";
        }
        if (!needsMeasurements(question)) {
            return "이 시안의 인중과 턱을 포함한 하안부에는 검수된 기준점이 없어 길이와 비율을 확인할 수 없어요. 지금은 원본의 콧볼 너비와 눈 안쪽 간격을 검수한 경우에만 비교할 수 있어요.";
        }
        Observation nose = observation(measurements, "alarWidth");
        Observation eyes = observation(measurements, "intercanthalDistance");
        if (nose == null || eyes == null || !Objects.equals(nose.definition(), eyes.definition())) {
            return "이 시안에는 확인된 원본 측정 기록이 없어 얼굴 비율을 수치로 설명하기 어려워요. 콧볼 너비는 양쪽 콧볼의 가장 바깥점, 눈 안쪽 간격은 양쪽 눈의 안쪽 모서리를 기준으로 재요. 궁금하시면 이 기준부터 설명해 드릴게요."
                    + LANDMARK_SOURCE;
        }
        double lower = nose.lower() / eyes.upper();
        double upper = nose.upper() / eyes.lower();
        if (!Double.isFinite(lower) || !Double.isFinite(upper) || lower <= 0) {
            return "이 시안의 검수 기록으로는 두 거리의 비율을 확인하기 어려워요.";
        }
        String comparison =
                nose.lower() > eyes.upper()
                        ? "이 3D 원본에서는 콧볼 너비가 눈 안쪽 간격보다 넓게 측정됐어요."
                        : nose.upper() < eyes.lower()
                                ? "이 3D 원본에서는 콧볼 너비가 눈 안쪽 간격보다 좁게 측정됐어요."
                                : "두 거리의 측정 범위가 겹쳐 어느 쪽이 더 넓은지는 단정하기 어려워요.";
        return comparison
                + "\n\n"
                + PRIVATE_MEASUREMENT_LABEL
                + " "
                + ratio(nose.lower(), eyes.upper(), RoundingMode.FLOOR)
                + "~"
                + ratio(nose.upper(), eyes.lower(), RoundingMode.CEILING)
                + "배"
                + " (검수 범위를 반영한 비율이에요.)\n\n현재는 이 두 거리만 확인할 수 있어요. 입술·턱·얼굴 전체의 균형을 이 비율 하나로 판단하지 않아요."
                + LANDMARK_SOURCE;
    }

    private static String ratio(double numerator, double denominator, RoundingMode rounding) {
        return BigDecimal.valueOf(numerator)
                .divide(BigDecimal.valueOf(denominator), 2, rounding)
                .toPlainString();
    }

    private static Observation observation(BaselineMeasurementResponse response, String code) {
        if (response == null || response.status() != BaselineMeasurementResponse.Status.AVAILABLE)
            return null;
        return response.observations().stream()
                .filter(
                        row ->
                                code.equals(row.code())
                                        && "model-space".equals(row.unit())
                                        && "reviewed-pair".equals(row.quality())
                                        && Double.isFinite(row.lower())
                                        && Double.isFinite(row.upper())
                                        && row.lower() > 0
                                        && row.lower() <= row.upper())
                .findFirst()
                .orElse(null);
    }
}
