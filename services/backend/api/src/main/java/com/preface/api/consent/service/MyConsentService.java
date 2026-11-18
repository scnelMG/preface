package com.preface.api.consent.service;

import com.preface.api.consent.dto.MyConsentResponse;
import com.preface.common.consent.entity.ConsentDocument;
import com.preface.common.consent.entity.ConsentType;
import com.preface.common.consent.entity.UserConsent;
import com.preface.common.consent.repository.UserConsentRepository;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 내 동의 기록(API-AUTH-09).
 *
 * <p>얼굴 동의 철회(API-AUTH-10)는 1차에서 없다 — 가입 동의 4종은 모두 필수이고, 동의를 거두려면 회원 탈퇴로 처리한다(10/26 팀 결정,
 * S15P31B204-354).
 */
@Service
@RequiredArgsConstructor
public class MyConsentService {

    private final UserRepository userRepository;
    private final UserConsentRepository userConsentRepository;
    private final ConsentDocumentService consentDocumentService;

    /** API-AUTH-09. 종류 순서(TERMS, PRIVACY, FACE_DATA, FACE_PUBLIC). */
    @Transactional(readOnly = true)
    public List<MyConsentResponse> myConsents(String userId) {
        activeUser(userId);
        List<ConsentHistory.Entry> entries =
                userConsentRepository.findAllByUser_IdOrderByActedAtDesc(userId).stream()
                        .map(MyConsentService::toEntry)
                        .toList();
        Map<ConsentType, String> currentIds = new EnumMap<>(ConsentType.class);
        consentDocumentService
                .currentByType()
                .forEach((type, d) -> currentIds.put(type, d.getId()));
        return ConsentHistory.summarize(entries, currentIds);
    }

    private void activeUser(String userId) {
        userRepository
                .findById(userId)
                .filter(User::isActive)
                .orElseThrow(() -> new BusinessException(AuthErrorCode.UNAUTHORIZED));
    }

    private static ConsentHistory.Entry toEntry(UserConsent c) {
        ConsentDocument d = c.getConsentDocument();
        return new ConsentHistory.Entry(
                c.getConsentType(),
                d.getId(),
                d.getTitle(),
                d.getVersion(),
                d.getEffectiveAt(),
                c.isAgreed(),
                c.getActedAt());
    }
}
