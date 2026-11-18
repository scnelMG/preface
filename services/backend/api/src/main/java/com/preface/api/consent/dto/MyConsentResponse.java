package com.preface.api.consent.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;

/**
 * API-AUTH-09 항목. 동의 종류마다 하나.
 *
 * @param title 마지막 기록이 가리키는 동의서(버전)의 제목
 * @param status {@code AGREED}·{@code WITHDRAWN} — 마지막 기록의 {@code agreed}
 * @param agreedAt 가장 최근 동의 시각. 동의 기록이 없으면 null
 * @param withdrawnAt 철회 상태일 때 철회 시각. 동의 상태면 null
 * @param isLatestVersion 마지막 기록의 동의서가 지금 시행 중인 버전인지
 */
public record MyConsentResponse(
        String consentType,
        String title,
        String version,
        Instant effectiveAt,
        String status,
        Instant agreedAt,
        Instant withdrawnAt,
        // is로 시작하는 boolean은 직렬화 이름에서 is가 빠질 수 있어 명세 이름을 고정한다
        @JsonProperty("isLatestVersion") boolean isLatestVersion) {

    public static final String AGREED = "AGREED";
    public static final String WITHDRAWN = "WITHDRAWN";
}
