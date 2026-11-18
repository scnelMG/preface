package com.preface.api.consent.controller;

import com.preface.api.consent.dto.ConsentDocumentResponse;
import com.preface.api.consent.service.ConsentDocumentService;
import com.preface.common.response.ApiResponse;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/consent-documents")
@RequiredArgsConstructor
public class ConsentDocumentController {

    private final ConsentDocumentService consentDocumentService;

    /** API-AUTH-07. 인증 없이(가입 토큰 포함) 부를 수 있다. */
    @GetMapping
    public ApiResponse<List<ConsentDocumentResponse>> list() {
        return ApiResponse.ok(consentDocumentService.currentDocuments());
    }
}
