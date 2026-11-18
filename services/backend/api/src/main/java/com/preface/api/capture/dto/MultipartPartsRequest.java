package com.preface.api.capture.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** 조각 URL 재발급 요청(S15P31B204-506, 가칭 API-CAP-06). 만료됐거나 실패한 조각 번호(1부터). */
public record MultipartPartsRequest(
        @NotEmpty @Size(max = 10_000) List<@NotNull Integer> partNumbers) {}
