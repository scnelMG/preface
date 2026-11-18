package com.preface;

/** 통합 테스트용 동의서 조회. 가입은 종류별 "지금 시행 중인" 동의서 하나씩만 받는다(ConsentDocumentService.currentByType). */
public final class ConsentFixtures {

    /**
     * 종류별 현재 버전 동의서 ID. 시행일이 지난 것 중 가장 늦게 시행된 것. 미리 넣은 새 버전(시행 전)이나 이전 버전을 섞으면 가입이
     * 400이다(S15P31B204-439에서 FACE_DATA 2026-10-v2를 미리 넣으며 추가).
     */
    public static final String CURRENT_DOCUMENT_IDS =
            "select d.id from consent_document d where d.effective_at <= utc_timestamp()"
                    + " and not exists (select 1 from consent_document n"
                    + " where n.consent_type = d.consent_type and n.effective_at <= utc_timestamp()"
                    + " and n.effective_at > d.effective_at)"
                    + " order by d.consent_type";

    private ConsentFixtures() {}
}
