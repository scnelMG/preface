package com.preface.api.consent.service;

import com.preface.api.consent.dto.ConsentDocumentResponse;
import com.preface.common.consent.entity.ConsentDocument;
import com.preface.common.consent.entity.ConsentType;
import com.preface.common.consent.repository.ConsentDocumentRepository;
import java.time.Clock;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 종류별 현재(최신 시행본) 동의서. */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ConsentDocumentService {

    private final ConsentDocumentRepository repository;
    private final Clock clock;

    public List<ConsentDocumentResponse> currentDocuments() {
        return currentByType().values().stream().map(ConsentDocumentResponse::from).toList();
    }

    /** 종류 순서(TERMS, PRIVACY, FACE_DATA, FACE_PUBLIC)로 정렬된 현재 버전. 가입 검증에도 쓴다. */
    public Map<ConsentType, ConsentDocument> currentByType() {
        Map<ConsentType, ConsentDocument> current = new EnumMap<>(ConsentType.class);
        for (ConsentDocument d :
                repository.findAllByEffectiveAtLessThanEqualOrderByEffectiveAtDesc(
                        clock.instant())) {
            current.putIfAbsent(d.getConsentType(), d);
        }
        return current;
    }
}
