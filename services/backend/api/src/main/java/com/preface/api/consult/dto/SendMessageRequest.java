package com.preface.api.consult.dto;

import java.util.Map;

/**
 * API-CON-01 요청. {@code content} 길이(1~300자)는 서비스가 검사해 CON_001로 답한다.
 *
 * @param content 자유 입력 또는 예시 칩 문장. 선택지 버튼이면 그 라벨
 * @param exampleId 예시 칩 ID(저장하지 않음). {@code consult-advice}이면 설명만 요청한다.
 * @param selectedOptionId 직전 되묻기의 선택지 ID
 * @param replyToRequestId 보완 대상 변경 요청(받기만 하고 쓰지 않음)
 * @param directControl 직접 조절에서 선택한 항목과 그때의 시안 버전
 * @param conversationAfterSeq 화면이 보고 있는 상담 경계값. 기존 클라이언트는 생략할 수 있다
 */
public record SendMessageRequest(
        String content,
        String exampleId,
        String selectedOptionId,
        String replyToRequestId,
        String requestId,
        ModeSwitch modeSwitch,
        DirectControl directControl,
        Integer conversationAfterSeq,
        String profileSection,
        ComparisonTarget comparisonTarget,
        Map<String, Double> recommendationMeasurements) {
    public SendMessageRequest(
            String content,
            String exampleId,
            String selectedOptionId,
            String replyToRequestId,
            String requestId,
            ModeSwitch modeSwitch,
            DirectControl directControl,
            Integer conversationAfterSeq,
            String profileSection) {
        this(
                content,
                exampleId,
                selectedOptionId,
                replyToRequestId,
                requestId,
                modeSwitch,
                directControl,
                conversationAfterSeq,
                profileSection,
                null,
                null);
    }

    public record ComparisonTarget(String code, Double value) {}

    public SendMessageRequest(
            String content,
            String exampleId,
            String selectedOptionId,
            String replyToRequestId,
            String requestId,
            ModeSwitch modeSwitch,
            DirectControl directControl,
            Integer conversationAfterSeq) {
        this(
                content,
                exampleId,
                selectedOptionId,
                replyToRequestId,
                requestId,
                modeSwitch,
                directControl,
                conversationAfterSeq,
                null);
    }

    public record ModeSwitch(String target, int stateVersion) {}

    public record DirectControl(String code, Integer stateVersion) {}

    public SendMessageRequest(
            String content, String exampleId, String selectedOptionId, String replyToRequestId) {
        this(content, exampleId, selectedOptionId, replyToRequestId, null, null, null, null);
    }

    public SendMessageRequest(
            String content,
            String exampleId,
            String selectedOptionId,
            String replyToRequestId,
            String requestId,
            ModeSwitch modeSwitch,
            DirectControl directControl) {
        this(
                content,
                exampleId,
                selectedOptionId,
                replyToRequestId,
                requestId,
                modeSwitch,
                directControl,
                null);
    }
}
