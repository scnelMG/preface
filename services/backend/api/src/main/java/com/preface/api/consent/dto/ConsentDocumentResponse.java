package com.preface.api.consent.dto;

import com.preface.common.consent.entity.ConsentDocument;
import java.time.Instant;

/** API-AUTH-07 항목. {@code summary}는 버전별 핵심 요약이고 없으면 null이다. */
public record ConsentDocumentResponse(
        String consentDocumentId,
        String consentType,
        String version,
        String title,
        String contentUrl,
        boolean required,
        String summary,
        Instant effectiveAt) {

    public static ConsentDocumentResponse from(ConsentDocument d) {
        return new ConsentDocumentResponse(
                d.getId(),
                d.getConsentType().name(),
                d.getVersion(),
                d.getTitle(),
                d.getContentUrl(),
                d.isRequired(),
                d.getSummary(),
                d.getEffectiveAt());
    }
}
