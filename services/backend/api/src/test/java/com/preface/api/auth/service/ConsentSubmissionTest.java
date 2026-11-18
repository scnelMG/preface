package com.preface.api.auth.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.api.auth.dto.SignupRequest.ConsentAgreement;
import com.preface.common.consent.entity.ConsentDocument;
import com.preface.common.consent.entity.ConsentType;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ConsentSubmissionTest {

    private final Map<ConsentType, ConsentDocument> current = currentDocuments();

    @Test
    void 현재_버전_4종에_모두_동의하면_통과한다() {
        assertThatCode(
                        () ->
                                ConsentSubmission.validate(
                                        agreements("d1", "d2", "d3", "d4"), current))
                .doesNotThrowAnyException();
    }

    @Test
    void 하나라도_빠지면_AUTH_031() {
        assertCode(agreements("d1", "d2", "d3"), AuthErrorCode.CONSENT_INCOMPLETE);
    }

    @Test
    void 같은_동의서를_두_번_보내면_AUTH_031() {
        assertCode(agreements("d1", "d2", "d3", "d3"), AuthErrorCode.CONSENT_INCOMPLETE);
    }

    @Test
    void 현재_버전이_아닌_동의서가_섞이면_AUTH_030() {
        assertCode(agreements("d1", "d2", "d3", "old-d4"), AuthErrorCode.CONSENT_OUTDATED);
    }

    @Test
    void 하나라도_거절하면_AUTH_031() {
        List<ConsentAgreement> submitted =
                List.of(
                        new ConsentAgreement("d1", true),
                        new ConsentAgreement("d2", true),
                        new ConsentAgreement("d3", true),
                        new ConsentAgreement("d4", false));
        assertCode(submitted, AuthErrorCode.CONSENT_INCOMPLETE);
    }

    private void assertCode(List<ConsentAgreement> submitted, AuthErrorCode code) {
        assertThatThrownBy(() -> ConsentSubmission.validate(submitted, current))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e ->
                                org.assertj.core.api.Assertions.assertThat(e.errorCode())
                                        .isEqualTo(code));
    }

    private static List<ConsentAgreement> agreements(String... ids) {
        return java.util.Arrays.stream(ids).map(id -> new ConsentAgreement(id, true)).toList();
    }

    private static Map<ConsentType, ConsentDocument> currentDocuments() {
        Map<ConsentType, ConsentDocument> map = new EnumMap<>(ConsentType.class);
        ConsentType[] types = ConsentType.values();
        for (int i = 0; i < types.length; i++) {
            ConsentDocument doc = mock(ConsentDocument.class);
            when(doc.getId()).thenReturn("d" + (i + 1));
            map.put(types[i], doc);
        }
        return map;
    }
}
