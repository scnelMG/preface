package com.preface.api.capture.service;

import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.JsonNode;

/**
 * 웹 녹화 촬영 기록(captureTrace, S15P31B204-640, 계획 S0-1·S0-8·F-3) 검사.
 *
 * <p>서버는 기록을 해석하지 않고 저장해 추출 워커에 넘긴다(claim 응답 {@code capture.trace}). 그래서 크기 상한과 시각 순서만 본다. 어긋나면
 * 업로드는 그대로 받고 기록만 버린다(촬영을 실패시키지 않는다). 로그에는 이유만 남기고 기록 내용은 남기지 않는다.
 *
 * <p>모양: {@code trace}는 {@code [tMs, yaw, pitch, found]} 줄의 배열(녹화 시작(MediaRecorder start) 기준 ms, 놓친
 * 표본은 각도 null), {@code steps}는 {@code {name, startMs, endMs}}의 배열. 나머지 키(meta·trackSettings·버전)는
 * 그대로 둔다. 명세: {@code contracts/frame-extraction/schemas/claim-response.schema.json}
 */
@Slf4j
final class CaptureTraces {

    static final int MAX_TRACE_POINTS = 2_000;
    static final int MAX_STEPS = 30;

    private CaptureTraces() {}

    /**
     * 저장할 JSON 문자열. 웹 녹화가 아니거나, 기록이 없거나, 검사에 걸리면 null.
     *
     * <p>업로드는 웹 녹화만 받으므로(S15P31B204-929, 정책 검사가 먼저 거절) 업로드 흐름에서는 항상 {@code WEB_RECORDER}로 불린다. 촬영
     * 방식 확인은 다른 곳에서 부를 때를 위한 방어로 남긴다.
     *
     * @param captureMethod 업로드 요청의 촬영 방식
     */
    static String sanitize(String captureMethod, JsonNode trace) {
        if (trace == null || trace.isNull() || trace.isMissingNode()) {
            return null;
        }
        if (!"WEB_RECORDER".equals(captureMethod)) {
            log.warn("captureTrace dropped: captureMethod={}", captureMethod);
            return null;
        }
        String reason = problem(trace);
        if (reason != null) {
            log.warn("captureTrace dropped: {}", reason);
            return null;
        }
        return trace.toString();
    }

    /** 문제가 있으면 이유, 없으면 null. */
    private static String problem(JsonNode trace) {
        if (!trace.isObject()) {
            return "not an object";
        }
        JsonNode points = trace.get("trace");
        if (points != null && !points.isNull()) {
            if (!points.isArray()) {
                return "trace is not an array";
            }
            if (points.size() > MAX_TRACE_POINTS) {
                return "trace points " + points.size() + " > " + MAX_TRACE_POINTS;
            }
            double last = Double.NEGATIVE_INFINITY;
            for (JsonNode row : points) {
                if (!row.isArray() || row.size() != 4 || !row.get(0).isNumber()) {
                    return "trace row is not [tMs, yaw, pitch, found]";
                }
                double t = row.get(0).asDouble();
                if (t <= last) {
                    return "trace time not increasing";
                }
                last = t;
            }
        }
        JsonNode steps = trace.get("steps");
        if (steps != null && !steps.isNull()) {
            if (!steps.isArray()) {
                return "steps is not an array";
            }
            if (steps.size() > MAX_STEPS) {
                return "steps " + steps.size() + " > " + MAX_STEPS;
            }
            double lastStart = Double.NEGATIVE_INFINITY;
            for (JsonNode step : steps) {
                JsonNode start = step.get("startMs");
                JsonNode end = step.get("endMs");
                if (start == null || end == null || !start.isNumber() || !end.isNumber()) {
                    return "step has no numeric startMs·endMs";
                }
                if (start.asDouble() > end.asDouble() || start.asDouble() < lastStart) {
                    return "step time not increasing";
                }
                lastStart = start.asDouble();
            }
        }
        return null;
    }
}
