package com.preface.api.consent.service;

import com.preface.api.consent.dto.MyConsentResponse;
import com.preface.common.consent.entity.ConsentType;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * 동의·철회 기록(append-only)을 종류별 현재 상태로 접는다(API-AUTH-09).
 *
 * <ul>
 *   <li>현재 상태 = 종류별 가장 최근 기록의 {@code agreed}(V1 DDL {@code user_consent.acted_at} 주석 S-03)
 *   <li>{@code agreedAt} = 가장 최근 동의 시각, {@code withdrawnAt} = 철회 상태일 때만 그 철회 시각
 *   <li>기록이 없는 종류는 목록에서 빠진다. 정상 가입이면 4종이 모두 있으므로, 빠진 것은 FE가 오류로 보여 준다(명세 AUTH-09)
 * </ul>
 */
final class ConsentHistory {

    private ConsentHistory() {}

    /** DB 엔티티와 떼어 놓은 기록 한 줄(단위 테스트가 엔티티 없이 만들 수 있게). */
    record Entry(
            ConsentType type,
            String documentId,
            String title,
            String version,
            Instant effectiveAt,
            boolean agreed,
            Instant actedAt) {}

    /**
     * @param newestFirst 한 회원의 기록 전체, 최근 것이 앞
     * @param currentDocumentIds 종류별 지금 시행 중인 동의서 ID
     */
    static List<MyConsentResponse> summarize(
            List<Entry> newestFirst, Map<ConsentType, String> currentDocumentIds) {
        Map<ConsentType, Entry> latest = new EnumMap<>(ConsentType.class);
        Map<ConsentType, Instant> lastAgreedAt = new EnumMap<>(ConsentType.class);
        for (Entry e : newestFirst) {
            latest.putIfAbsent(e.type(), e);
            if (e.agreed()) {
                lastAgreedAt.putIfAbsent(e.type(), e.actedAt());
            }
        }
        List<MyConsentResponse> result = new ArrayList<>();
        for (Map.Entry<ConsentType, Entry> item : latest.entrySet()) {
            Entry e = item.getValue();
            result.add(
                    new MyConsentResponse(
                            e.type().name(),
                            e.title(),
                            e.version(),
                            e.effectiveAt(),
                            e.agreed() ? MyConsentResponse.AGREED : MyConsentResponse.WITHDRAWN,
                            lastAgreedAt.get(e.type()),
                            e.agreed() ? null : e.actedAt(),
                            e.documentId().equals(currentDocumentIds.get(e.type()))));
        }
        return result;
    }
}
