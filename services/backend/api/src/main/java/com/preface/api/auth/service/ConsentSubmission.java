package com.preface.api.auth.service;

import com.preface.api.auth.dto.SignupRequest.ConsentAgreement;
import com.preface.common.consent.entity.ConsentDocument;
import com.preface.common.consent.entity.ConsentType;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 가입 때 제출한 동의 검사(API-AUTH-08).
 *
 * <ul>
 *   <li>개수가 현재 동의서 수와 다르거나 같은 ID가 두 번 → AUTH_031
 *   <li>현재 버전이 아닌 ID(구버전·모르는 ID) → AUTH_030 (FE가 동의서를 다시 받는다)
 *   <li>하나라도 {@code agreed=false} → AUTH_031
 * </ul>
 */
final class ConsentSubmission {

    private ConsentSubmission() {}

    static void validate(
            List<ConsentAgreement> submitted, Map<ConsentType, ConsentDocument> current) {
        if (current.size() != ConsentType.values().length) {
            throw new IllegalStateException("consent documents not seeded: " + current.keySet());
        }
        Set<String> ids = new HashSet<>();
        for (ConsentAgreement a : submitted) {
            ids.add(a.consentDocumentId());
        }
        if (submitted.size() != current.size() || ids.size() != submitted.size()) {
            throw new BusinessException(AuthErrorCode.CONSENT_INCOMPLETE);
        }
        Set<String> currentIds =
                current.values().stream().map(ConsentDocument::getId).collect(Collectors.toSet());
        if (!currentIds.equals(ids)) {
            throw new BusinessException(AuthErrorCode.CONSENT_OUTDATED);
        }
        if (submitted.stream().anyMatch(a -> !Boolean.TRUE.equals(a.agreed()))) {
            throw new BusinessException(AuthErrorCode.CONSENT_INCOMPLETE);
        }
    }
}
