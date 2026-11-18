package com.preface.api.admin.dto;

import java.util.List;

/**
 * 관리자 목록 공통 페이지 형식(관리자 API 계약 "페이지 형식").
 *
 * @param page 0부터
 * @param size 기본 20, 최대 100
 */
public record AdminPage<T>(List<T> items, int page, int size, long totalElements, int totalPages) {

    public static <T> AdminPage<T> of(List<T> items, int page, int size, long totalElements) {
        int totalPages = size <= 0 ? 0 : (int) ((totalElements + size - 1) / size);
        return new AdminPage<>(items, page, size, totalElements, totalPages);
    }
}
