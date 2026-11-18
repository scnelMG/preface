package com.preface.api.share.service;

import com.preface.common.consent.entity.ConsentType;
import com.preface.common.consent.entity.UserConsent;
import com.preface.common.consent.repository.UserConsentRepository;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.time.Clock;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 얼굴 데이터 공개 동의({@code FACE_PUBLIC}) 판정. 동의 현재 상태 = 가장 최근 기록(FaceUploadGateway의 FACE_DATA와 같은 규칙).
 *
 * <p>버전 문자열은 {@code YYYY-MM-vN}이라 사전순 비교로 앞뒤를 가린다. 같은 달에 v10 이상은 없다고 본다.
 */
@Component
@RequiredArgsConstructor
public class ShareConsentPolicy {

    private final UserRepository userRepository;
    private final UserConsentRepository userConsentRepository;
    private final Clock clock;
    private final ShareProperties properties;

    /** 공유 보기(API-SHR-04): 공유한 사람이 아직 회원이고 공개 동의를 거두지 않았다. */
    public boolean stillPublic(String userId) {
        return latestAgreed(userId).isPresent();
    }

    /** 공유 만들기(API-SHR-01): 공개 기능을 알린 최소 버전 이상, 시행된 문서에 동의했다. */
    public boolean canShare(String userId) {
        if (!properties.sharingOpen()) {
            return false;
        }
        return latestAgreed(userId)
                .map(UserConsent::getConsentDocument)
                .filter(d -> d.getVersion().compareTo(properties.facePublicMinVersion()) >= 0)
                .filter(d -> !d.getEffectiveAt().isAfter(clock.instant()))
                .isPresent();
    }

    private Optional<UserConsent> latestAgreed(String userId) {
        boolean active = userRepository.findById(userId).map(User::isActive).orElse(false);
        if (!active) {
            return Optional.empty();
        }
        return userConsentRepository
                .findFirstByUser_IdAndConsentTypeOrderByActedAtDesc(userId, ConsentType.FACE_PUBLIC)
                .filter(UserConsent::isAgreed);
    }
}
