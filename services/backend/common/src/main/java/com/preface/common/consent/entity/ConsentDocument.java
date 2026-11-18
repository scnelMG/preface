package com.preface.common.consent.entity;

import com.preface.common.jpa.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 동의서 버전. 종류별로 {@code effective_at}이 가장 늦은 시행본이 현재 버전이다. 행은 migration으로만 넣는다. */
@Getter
@Entity
@Table(name = "consent_document")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ConsentDocument extends BaseTimeEntity {

    @Id
    @Column(length = 36)
    private String id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ConsentType consentType;

    @Column(nullable = false, length = 20)
    private String version;

    @Column(nullable = false, length = 100)
    private String title;

    @Column(nullable = false, length = 500)
    private String contentUrl;

    /** 가입 화면에 보여 줄 핵심 요약. 없으면 null(FE는 전문 링크만 보여 준다). */
    @Column(length = 500)
    private String summary;

    @Column(nullable = false)
    private boolean required;

    @Column(nullable = false)
    private Instant effectiveAt;
}
