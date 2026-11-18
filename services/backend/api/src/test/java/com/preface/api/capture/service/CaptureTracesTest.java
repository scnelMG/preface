package com.preface.api.capture.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 웹 녹화 촬영 기록(captureTrace, S15P31B204-640) 검사. 값은 모두 합성이다. */
class CaptureTracesTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private static JsonNode json(String text) {
        return MAPPER.readTree(text);
    }

    private static final String VALID =
            """
            {"version":1,"guideVersion":"g","trackerVersion":"mediapipe-0.10.14",
             "meta":{"durationMs":31200,"stopReason":"complete","stepsDone":6,"stepsTotal":6,"mimeType":"video/mp4"},
             "steps":[{"name":"recleft","startMs":0,"endMs":50},{"name":"sweepleft","startMs":50,"endMs":4200}],
             "trace":[[0,2.1,-3.0,1],[50,3.4,-2.8,1],[9800,null,null,0]],
             "trackSettings":{"width":1920}}
            """;

    @Test
    void 웹_녹화의_올바른_기록은_그대로_JSON으로_남긴다() {
        String stored = CaptureTraces.sanitize("WEB_RECORDER", json(VALID));
        assertThat(stored).isNotNull();
        assertThat(json(stored)).isEqualTo(json(VALID));
    }

    @Test
    void 기록이_없거나_웹_녹화가_아니면_남기지_않는다() {
        assertThat(CaptureTraces.sanitize("WEB_RECORDER", null)).isNull();
        assertThat(CaptureTraces.sanitize("FILE", json(VALID))).isNull();
        assertThat(CaptureTraces.sanitize(null, json(VALID))).isNull();
    }

    @Test
    void 객체가_아니면_버린다() {
        assertThat(CaptureTraces.sanitize("WEB_RECORDER", json("[1,2]"))).isNull();
        assertThat(CaptureTraces.sanitize("WEB_RECORDER", json("\"x\""))).isNull();
    }

    @Test
    void trace가_2000점을_넘으면_버리고_2000점은_받는다() {
        assertThat(CaptureTraces.sanitize("WEB_RECORDER", json(withTrace(2000)))).isNotNull();
        assertThat(CaptureTraces.sanitize("WEB_RECORDER", json(withTrace(2001)))).isNull();
    }

    @Test
    void steps가_30개를_넘으면_버린다() {
        StringBuilder steps = new StringBuilder();
        for (int i = 0; i < 31; i++) {
            if (i > 0) steps.append(',');
            steps.append(
                    "{\"name\":\"s\",\"startMs\":%d,\"endMs\":%d}".formatted(i * 10, i * 10 + 5));
        }
        assertThat(CaptureTraces.sanitize("WEB_RECORDER", json("{\"steps\":[" + steps + "]}")))
                .isNull();
    }

    @Test
    void trace_시각이_증가하지_않으면_버린다() {
        assertThat(
                        CaptureTraces.sanitize(
                                "WEB_RECORDER",
                                json("{\"trace\":[[0,1,1,1],[50,1,1,1],[50,1,1,1]]}")))
                .isNull();
        assertThat(
                        CaptureTraces.sanitize(
                                "WEB_RECORDER", json("{\"trace\":[[100,1,1,1],[50,1,1,1]]}")))
                .isNull();
    }

    @Test
    void trace_한_줄이_시각_yaw_pitch_found_네_칸이_아니면_버린다() {
        assertThat(CaptureTraces.sanitize("WEB_RECORDER", json("{\"trace\":[[0,1,1]]}"))).isNull();
        assertThat(CaptureTraces.sanitize("WEB_RECORDER", json("{\"trace\":[[\"a\",1,1,1]]}")))
                .isNull();
    }

    @Test
    void steps_시각이_거꾸로면_버린다() {
        assertThat(
                        CaptureTraces.sanitize(
                                "WEB_RECORDER",
                                json(
                                        "{\"steps\":[{\"name\":\"a\",\"startMs\":100,\"endMs\":50}]}")))
                .isNull();
        assertThat(
                        CaptureTraces.sanitize(
                                "WEB_RECORDER",
                                json(
                                        "{\"steps\":[{\"name\":\"a\",\"startMs\":100,\"endMs\":200},"
                                                + "{\"name\":\"b\",\"startMs\":50,\"endMs\":60}]}")))
                .isNull();
    }

    private static String withTrace(int points) {
        StringBuilder rows = new StringBuilder();
        for (int i = 0; i < points; i++) {
            if (i > 0) rows.append(',');
            rows.append("[%d,1.5,-2.0,1]".formatted(i * 50));
        }
        return "{\"trace\":[" + rows + "]}";
    }
}
