package com.preface.api.consult.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.facemodel.dto.BaselineMeasurementResponse;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse.Observation;
import java.util.List;
import org.junit.jupiter.api.Test;

class FaceRatioConsultationTest {
    @Test
    void 측정_범위가_겹치면_비율은_표시하되_어느_쪽이_넓은지_판단하지_않는다() {
        var reviewed =
                new BaselineMeasurementResponse(
                        BaselineMeasurementResponse.Status.AVAILABLE,
                        List.of(
                                observation("alarWidth", 29, 30),
                                observation("intercanthalDistance", 30, 31)));
        assertThat(FaceRatioConsultation.answer("콧볼 너비와 눈 안쪽 간격", reviewed))
                .contains("측정 범위가 겹쳐", "0.93~1.00배")
                .doesNotContain("넓게 측정", "좁게 측정");
    }

    @Test
    void 미검수_시안과_입술_선호_연구는_개인_측정값을_만들지_않는다() {
        var deferred =
                new BaselineMeasurementResponse(
                        BaselineMeasurementResponse.Status.DEFERRED, List.of());
        assertThat(FaceRatioConsultation.answer("콧볼 너비와 눈 안쪽 간격", deferred))
                .contains("측정 기록이 없어")
                .doesNotContain("배");
        assertThat(FaceRatioConsultation.answer("트렌디 볼륨", deferred))
                .contains(
                        "1:1이",
                        "1:1.6이",
                        "개인을 평가하는 기준으로 쓰지 않아요",
                        "검수된 입술 측정값이 없어",
                        "28318919",
                        "35666164");
        assertThat(FaceRatioConsultation.answer("황금비율", deferred)).contains("38228978");
        assertThat(FaceRatioConsultation.isQuestion("콧볼 너비만 조금 좁혀줘")).isFalse();
        assertThat(FaceRatioConsultation.isQuestion("콧볼 너비 +10%")).isFalse();
        assertThat(FaceRatioConsultation.isQuestion("콧볼 너비 10으로")).isFalse();
        assertThat(FaceRatioConsultation.isQuestion("눈 안쪽 간격과 콧볼 너비가 어떤가요?")).isTrue();
        assertThat(FaceRatioConsultation.isQuestion("콧볼 너비와 눈 안쪽 간격을 비교해 주세요")).isTrue();
        assertThat(FaceRatioConsultation.needsMeasurements("내안각 간격과 콧볼 너비 차이")).isTrue();
        assertThat(FaceRatioConsultation.needsMeasurements("얼굴 전체 비율을 분석해 줘")).isFalse();
        assertThat(FaceRatioConsultation.isQuestion("정면에서 콧볼 너비를 비교하고 싶어요. 코끝은 그대로 두고 싶어요."))
                .isFalse();
    }

    private static Observation observation(String code, double lower, double upper) {
        return new Observation(
                code, code, "audit-v1", "model-space", "reviewed-pair", lower, upper, "");
    }
}
