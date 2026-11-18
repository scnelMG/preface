package com.preface.common.response;

/**
 * 모든 외부 API의 공통 응답 형식. API 명세서 v2.7 "0. 공통 규칙"과 같다.
 *
 * <pre>
 * { "success": true,  "data": { }, "error": null }
 * { "success": false, "data": null, "error": { "code": "REC_002", "message": "...", "details": [] } }
 * </pre>
 */
public record ApiResponse<T>(boolean success, T data, ErrorBody error) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null);
    }

    public static ApiResponse<Void> ok() {
        return new ApiResponse<>(true, null, null);
    }

    public static ApiResponse<Void> fail(ErrorBody error) {
        return new ApiResponse<>(false, null, error);
    }
}
