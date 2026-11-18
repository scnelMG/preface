package com.preface.api.consult.dto;

import com.preface.api.simulation.dto.EditResultResponse;
import java.util.List;

/**
 * API-CON-01 응답. {@code changeRequest}는 편집 <b>후보</b>다 — 적용 성공 문구는 API-EDIT-05 성공 응답으로 만든다.
 *
 * @param recommendedSliderCode 조절 범위 질문일 때 FE가 열 슬라이더 코드(없으면 null)
 * @param morphResult 되돌리기·앞으로 가기·초기화 요청이면 그 결과(EDIT-06/08/07과 같은 모양)
 */
public record SendMessageResponse(
        UserMessage userMessage,
        AssistantMessage assistantMessage,
        ChangeRequestView changeRequest,
        boolean needsClarification,
        List<Option> options,
        String recommendedSliderCode,
        EditResultResponse morphResult,
        String profileSection) {

    public record UserMessage(String id, String content, boolean masked) {}

    /**
     * @param intent FastAPI 계약 값 {@code EDIT|CLARIFY|REPLY}, Spring이 처리한 {@code UNDO|REDO|RESET}
     */
    public record AssistantMessage(
            String id, String sender, String content, String intent, boolean filtered) {}

    public record Option(String id, String label) {}
}
