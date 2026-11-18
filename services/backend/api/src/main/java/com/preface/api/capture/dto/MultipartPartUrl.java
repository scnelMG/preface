package com.preface.api.capture.dto;

import java.util.Map;

/**
 * 조각 하나의 presigned PUT(S15P31B204-506). FE는 {@code headers}를 그대로 붙여 그 조각 바이트를 PUT하고 응답 {@code
 * ETag}를 모은다.
 *
 * <p>{@code url}은 서명 원문이라 toString에 넣지 않는다.
 */
public record MultipartPartUrl(int partNumber, String url, Map<String, String> headers) {

    @Override
    public String toString() {
        return "MultipartPartUrl[partNumber=" + partNumber + ", url=***]";
    }
}
