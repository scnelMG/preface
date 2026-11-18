package com.preface.api.consent.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.consent.dto.MyConsentResponse;
import com.preface.common.consent.entity.ConsentType;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ConsentHistoryTest {

    private static final Instant EFFECTIVE = Instant.parse("2026-10-01T00:00:00Z");
    private static final Instant AGREED_AT = Instant.parse("2026-10-20T00:00:00Z");
    private static final Instant WITHDRAWN_AT = Instant.parse("2026-10-23T00:00:00Z");

    @Test
    void 종류별_마지막_기록이_현재_상태이고_철회면_철회_시각과_마지막_동의_시각을_함께_준다() {
        List<ConsentHistory.Entry> newestFirst =
                List.of(
                        entry(ConsentType.FACE_DATA, "d-3", false, WITHDRAWN_AT),
                        entry(ConsentType.FACE_DATA, "d-3", true, AGREED_AT),
                        entry(ConsentType.TERMS, "d-1", true, AGREED_AT));

        List<MyConsentResponse> result =
                ConsentHistory.summarize(
                        newestFirst,
                        Map.of(ConsentType.TERMS, "d-1", ConsentType.FACE_DATA, "d-3"));

        assertThat(result)
                .extracting(MyConsentResponse::consentType)
                .as("종류 순서, 기록 없는 종류는 빠진다")
                .containsExactly("TERMS", "FACE_DATA");
        MyConsentResponse terms = result.get(0);
        assertThat(terms.status()).isEqualTo("AGREED");
        assertThat(terms.agreedAt()).isEqualTo(AGREED_AT);
        assertThat(terms.withdrawnAt()).isNull();
        MyConsentResponse face = result.get(1);
        assertThat(face.status()).isEqualTo("WITHDRAWN");
        assertThat(face.agreedAt()).isEqualTo(AGREED_AT);
        assertThat(face.withdrawnAt()).isEqualTo(WITHDRAWN_AT);
        assertThat(face.isLatestVersion()).isTrue();
    }

    @Test
    void 마지막_기록의_동의서가_현재_시행본이_아니면_최신_버전이_아니다() {
        List<MyConsentResponse> result =
                ConsentHistory.summarize(
                        List.of(entry(ConsentType.PRIVACY, "d-old", true, AGREED_AT)),
                        Map.of(ConsentType.PRIVACY, "d-new"));

        assertThat(result.getFirst().isLatestVersion()).isFalse();
        assertThat(result.getFirst().version()).isEqualTo("v-d-old");
    }

    private static ConsentHistory.Entry entry(
            ConsentType type, String documentId, boolean agreed, Instant at) {
        return new ConsentHistory.Entry(
                type, documentId, "제목 " + type, "v-" + documentId, EFFECTIVE, agreed, at);
    }
}
