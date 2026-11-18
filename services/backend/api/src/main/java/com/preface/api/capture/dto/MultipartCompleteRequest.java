package com.preface.api.capture.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/** multipart 업로드 완료 요청(S15P31B204-506, 가칭 API-CAP-07). 모든 조각의 번호와 S3가 돌려준 ETag. */
public record MultipartCompleteRequest(
        @NotEmpty @Size(max = 10_000) List<@Valid @NotNull Part> parts) {

    public record Part(@NotNull Integer partNumber, @NotBlank @Size(max = 128) String etag) {}
}
