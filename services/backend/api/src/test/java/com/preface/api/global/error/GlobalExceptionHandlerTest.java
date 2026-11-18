package com.preface.api.global.error;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** 예외가 API 명세서의 공통 실패 응답 형식으로 나가는지 확인한다. */
class GlobalExceptionHandlerTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc =
                MockMvcBuilders.standaloneSetup(new SampleController())
                        .setControllerAdvice(new GlobalExceptionHandler())
                        .build();
    }

    @Test
    void 비즈니스_예외는_코드와_HTTP_상태를_그대로_쓴다() throws Exception {
        mockMvc.perform(get("/sample/not-found"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.data").doesNotExist())
                .andExpect(jsonPath("$.error.code").value("COMMON_002"));
    }

    @Test
    void 검증_실패는_COMMON_001과_필드별_사유를_준다() throws Exception {
        mockMvc.perform(
                        post("/sample/body")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"))
                .andExpect(jsonPath("$.error.details[0].field").value("name"));
    }

    @Test
    void 읽을_수_없는_본문도_COMMON_001이다() throws Exception {
        mockMvc.perform(
                        post("/sample/body")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("COMMON_001"));
    }

    @Test
    void 예상하지_못한_예외는_내부_사유를_숨기고_COMMON_999를_준다() throws Exception {
        mockMvc.perform(get("/sample/boom"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error.code").value("COMMON_999"))
                .andExpect(
                        jsonPath("$.error.message")
                                .value(CommonErrorCode.INTERNAL_ERROR.message()));
    }

    @RestController
    static class SampleController {

        @GetMapping("/sample/not-found")
        String notFound() {
            throw new BusinessException(CommonErrorCode.NOT_FOUND, "sample owner mismatch");
        }

        @GetMapping("/sample/boom")
        String boom() {
            throw new IllegalStateException("db password=should-not-leak");
        }

        @PostMapping("/sample/body")
        String body(@Valid @RequestBody SampleRequest request) {
            return request.name();
        }
    }

    record SampleRequest(@NotBlank String name) {}
}
