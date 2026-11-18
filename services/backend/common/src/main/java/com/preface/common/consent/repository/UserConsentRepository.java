package com.preface.common.consent.repository;

import com.preface.common.consent.entity.ConsentType;
import com.preface.common.consent.entity.UserConsent;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserConsentRepository extends JpaRepository<UserConsent, String> {

    /** 종류별 가장 최근 동의·철회 기록. 기록이 append-only라 이 행의 {@code agreed}가 현재 상태다. */
    Optional<UserConsent> findFirstByUser_IdAndConsentTypeOrderByActedAtDesc(
            String userId, ConsentType consentType);

    /** 회원의 동의·철회 기록 전체, 최근 것이 앞(API-AUTH-09). 동의서(제목·버전)를 함께 읽는다. */
    @EntityGraph(attributePaths = "consentDocument")
    List<UserConsent> findAllByUser_IdOrderByActedAtDesc(String userId);
}
