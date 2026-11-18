package com.preface.common.consent.repository;

import com.preface.common.consent.entity.ConsentDocument;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConsentDocumentRepository extends JpaRepository<ConsentDocument, String> {

    /** 시행된 동의서 전체, 최신 시행본이 앞. 종류별 첫 행이 현재 버전이다(행 수가 종류×버전이라 적다). */
    List<ConsentDocument> findAllByEffectiveAtLessThanEqualOrderByEffectiveAtDesc(Instant now);
}
