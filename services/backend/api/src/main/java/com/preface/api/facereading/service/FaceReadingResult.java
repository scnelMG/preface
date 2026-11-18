package com.preface.api.facereading.service;

import java.util.Set;
import tools.jackson.databind.JsonNode;

/**
 * 관상 결과 JSON 형식과 검사. GMS {@code json_schema}(strict)로 형식을 강제하고, 저장 전에 개수·길이를 한 번 더 본다. 내용(단점·단정·시술
 * 언급)은 막지 않는다 — 실제 관상가처럼 장단점을 말하게 하려고 금지 표현 검사를 없앴다(-694).
 *
 * <pre>
 * { "title": "한 줄 별명",
 *   "parts": [{"part": "FOREHEAD", "name": "이마", "reading": "한 문장"}],   // 3~4개
 *   "overall": "종합 풀이",
 *   "advice": [{"part": "NOSE", "change": "이렇게 바꾸면", "effect": "관상이 이렇게"}] }  // 1~2개, 얼굴 전체
 * </pre>
 *
 * <p>길이는 "말이 많아 읽기 어렵다"는 피드백(S15P31B204-452)으로 줄였다가, 생김새 근거와 장단점을 담도록 다시 늘렸다(-694: 부위 120자·종합
 * 260자). 이미 저장된 결과는 조회 때 다시 검사하지 않는다.
 */
final class FaceReadingResult {

    static final Set<String> PARTS =
            Set.of("FOREHEAD", "EYEBROWS", "EYES", "NOSE", "MOUTH", "CHIN", "CHEEKS", "EARS");

    static final String SCHEMA =
            """
            {"type":"object","additionalProperties":false,
             "required":["title","parts","overall","advice"],
             "properties":{
              "title":{"type":"string"},
              "parts":{"type":"array","items":{"type":"object","additionalProperties":false,
                "required":["part","name","reading"],
                "properties":{
                  "part":{"type":"string","enum":["FOREHEAD","EYEBROWS","EYES","NOSE","MOUTH","CHIN","CHEEKS","EARS"]},
                  "name":{"type":"string"},
                  "reading":{"type":"string"}}}},
              "overall":{"type":"string"},
              "advice":{"type":"array","items":{"type":"object","additionalProperties":false,
                "required":["part","change","effect"],
                "properties":{
                  "part":{"type":"string","enum":["FOREHEAD","EYEBROWS","EYES","NOSE","MOUTH","CHIN","CHEEKS","EARS"]},
                  "change":{"type":"string"},
                  "effect":{"type":"string"}}}}}}
            """;

    private FaceReadingResult() {}

    /** 형식·개수·길이 검사. 통과하지 못하면 {@code AI_REJECTED}. */
    static void validate(JsonNode result) {
        text(result, "title", 2, 30);
        text(result, "overall", 10, 260);
        JsonNode parts = result.path("parts");
        if (!parts.isArray() || parts.size() < 3 || parts.size() > 4) reject("parts count");
        for (JsonNode part : parts) {
            if (!PARTS.contains(part.path("part").asText(""))) reject("part code");
            text(part, "name", 1, 10);
            text(part, "reading", 8, 120);
        }
        JsonNode advice = result.path("advice");
        if (!advice.isArray() || advice.isEmpty() || advice.size() > 2) reject("advice count");
        for (JsonNode item : advice) {
            if (!PARTS.contains(item.path("part").asText(""))) reject("advice part");
            text(item, "change", 4, 50);
            text(item, "effect", 4, 60);
        }
    }

    private static void text(JsonNode node, String field, int min, int max) {
        JsonNode value = node.path(field);
        if (!value.isTextual()) reject(field + " missing");
        String s = value.asText().strip();
        if (s.length() < min || s.length() > max) reject(field + " length");
    }

    private static void reject(String detail) {
        throw new FaceReadingFailure(FaceReadingFailure.AI_REJECTED, detail);
    }
}
