package com.preface.common.consent.entity;

import com.preface.common.user.entity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

/**
 * 동의·철회 기록(append-only, 법적 증빙). 철회도 {@code agreed=false}인 새 행으로 쌓는다.
 *
 * <p>시각 컬럼이 {@code acted_at}(ms) 하나라 공통 기본 클래스를 쓰지 않는다.
 */
@Getter
@Entity
@Table(name = "user_consent")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserConsent {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "consent_document_id", nullable = false)
    private ConsentDocument consentDocument;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ConsentType consentType;

    @Column(nullable = false)
    private boolean agreed;

    @Column(nullable = false)
    private Instant actedAt;

    public static UserConsent agree(User user, ConsentDocument document, Instant at) {
        UserConsent consent = new UserConsent();
        consent.user = user;
        consent.consentDocument = document;
        consent.consentType = document.getConsentType();
        consent.agreed = true;
        consent.actedAt = at;
        return consent;
    }

    /** 철회 기록. 기존 동의 행은 고치지 않고 {@code agreed=false} 행을 새로 쌓는다. */
    public static UserConsent withdraw(User user, ConsentDocument document, Instant at) {
        UserConsent consent = agree(user, document, at);
        consent.agreed = false;
        return consent;
    }
}
