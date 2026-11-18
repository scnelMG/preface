package com.preface.api.reconstruction.service;

import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** JSON 컬럼 직렬화. 워커가 보낸 자유 형식 객체는 크기 상한(64KB)을 넘으면 400이다. */
@Component
class JsonColumns {

    static final int MAX_BYTES = 64 * 1024;

    private final ObjectMapper objectMapper;

    JsonColumns(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /** null이면 null. */
    String write(String field, Object value) {
        if (value == null) {
            return null;
        }
        String json = objectMapper.writeValueAsString(value);
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST, field + " too large");
        }
        return json;
    }

    /** null·빈 값이면 null. */
    Map<String, Object> readMap(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
    }

    List<String> readStringList(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        return objectMapper.readValue(json, new TypeReference<List<String>>() {});
    }
}
