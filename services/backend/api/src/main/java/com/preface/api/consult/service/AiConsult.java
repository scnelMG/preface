package com.preface.api.consult.service;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.preface.api.consult.dto.EditAction;
import com.preface.api.consult.dto.SkippedClause;
import java.util.List;
import java.util.Map;

/**
 * Spring 내부 상담 문맥과 후보. 기존 INT-AI-01 형식을 보존해 CON-01 저장 계약에 사용한다.
 *
 * <p><b>얼굴 사진·영상·3D 이미지 필드는 두지 않는다</b>(REQ-N-10). 요청은 아래 레코드의 필드만 직렬화되므로 이미지·URL을 실을 자리가 없다.
 */
public final class AiConsult {

    private AiConsult() {}

    /**
     * @param currentRequest 직전 성공 거래 {@code {"actions": [...]}} — "더/덜"·지시어 해석용(없으면 null)
     * @param recentMessages 최근 대화 최대 10개(마스킹본)
     * @param measurements 얼굴 측정값(텍스트 수치). S15P31B204-122 검증 전까지 GMS에는 보내지 않는다
     * @param allowedCodes 이 시안이 저장할 수 있는 v2 저장 코드(눈은 좌우 포함)
     */
    public record Request(
            String simulationId,
            String requestId,
            Message message,
            Map<String, Object> currentRequest,
            List<RecentMessage> recentMessages,
            Map<String, Double> measurements,
            MorphStateBody morphState,
            List<String> allowedParts,
            List<String> allowedCodes) {}

    /** 선택지 처리는 ConsultService가 하므로 {@code selectedOptionId}는 항상 null이다. */
    public record Message(String content, String selectedOptionId, String profileSection) {
        public Message(String content, String selectedOptionId) {
            this(content, selectedOptionId, null);
        }
    }

    /**
     * @param role {@code user|assistant}
     */
    public record RecentMessage(String role, String content, List<GuidedChoice> choices) {
        public RecentMessage(String role, String content) {
            this(role, content, List.of());
        }
    }

    public record GuidedChoice(String id, String code, String label) {}

    public record MorphStateBody(
            String schemaVersion,
            Map<String, Double> weights,
            boolean weightResetRequired,
            boolean weightContourCombineAllowed) {
        public MorphStateBody(String schemaVersion, Map<String, Double> weights) {
            this(schemaVersion, weights, false, false);
        }

        public MorphStateBody(
                String schemaVersion, Map<String, Double> weights, boolean weightResetRequired) {
            this(schemaVersion, weights, weightResetRequired, false);
        }
    }

    /**
     * @param intent {@code EDIT|CLARIFY|REPLY}
     * @param changeRequest 편집 후보. EDIT이 아니면 null
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Response(
            String maskedUserContent,
            boolean masked,
            String assistantMessage,
            String intent,
            CandidateRequest changeRequest,
            boolean needsClarification,
            List<Option> options,
            boolean filtered,
            String recommendedSliderCode,
            String profileSection) {
        public Response(
                String maskedUserContent,
                boolean masked,
                String assistantMessage,
                String intent,
                CandidateRequest changeRequest,
                boolean needsClarification,
                List<Option> options,
                boolean filtered,
                String recommendedSliderCode) {
            this(
                    maskedUserContent,
                    masked,
                    assistantMessage,
                    intent,
                    changeRequest,
                    needsClarification,
                    options,
                    filtered,
                    recommendedSliderCode,
                    null);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CandidateRequest(
            String status,
            String schemaVersion,
            List<EditAction> actions,
            List<SkippedClause> skipped) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Option(String label, @JsonIgnore String guideCode) {
        // 기본 모델 상담의 기존 응답 필드는 빈 목록으로 유지한다.
        @JsonProperty("actions")
        public List<EditAction> actions() {
            return List.of();
        }
    }
}
