package com.preface.common.share.entity;

import com.preface.common.jpa.CreatedAtEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

/**
 * 시안 공유 링크(API-SHR, S15P31B204-574). {@code morphState}는 공유 시점 스냅숏이라 원본 시안을 고쳐도 바뀌지 않는다.
 *
 * <p>토큰 원문은 저장하지 않는다. {@code tokenHash}로만 찾는다.
 */
@Getter
@Entity
@Table(name = "simulation_share")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SimulationShare extends CreatedAtEntity {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 36)
    private String userId;

    @Column(nullable = false, length = 36)
    private String simulationId;

    @Column(nullable = false, length = 36)
    private String faceModelId;

    @Column(nullable = false, length = 44)
    private String tokenHash;

    @Column(nullable = false, columnDefinition = "json")
    private String morphState;

    @Column(length = 36)
    private String hairTemplateId;

    /** 공유 시점 웹 헤어 ID(편집실 정적 헤어, S15P31B204-842). 서버 헤어 템플릿과 다른 목록이다. */
    @Column(length = 36)
    private String hairAssetId;

    /** 받는 사람에게 보일 이름. 공유한 사람이 직접 적은 값만(S15P31B204-843), 없으면 {@code null}. */
    @Column(length = 20)
    private String senderName;

    @Column(nullable = false)
    private Instant expiresAt;

    private Instant revokedAt;

    public static SimulationShare create(
            String userId,
            String simulationId,
            String faceModelId,
            String tokenHash,
            String morphState,
            String hairTemplateId,
            String hairAssetId,
            String senderName,
            Instant expiresAt) {
        SimulationShare share = new SimulationShare();
        share.userId = userId;
        share.simulationId = simulationId;
        share.faceModelId = faceModelId;
        share.tokenHash = tokenHash;
        share.morphState = morphState;
        share.hairTemplateId = hairTemplateId;
        share.hairAssetId = hairAssetId;
        share.senderName = senderName;
        share.expiresAt = expiresAt;
        return share;
    }

    /** API-SHR-03. 이미 끝났으면 처음 끝낸 시각을 그대로 둔다(멱등). */
    public void revoke(Instant now) {
        if (revokedAt == null) {
            revokedAt = now;
        }
    }

    public boolean isOpen(Instant now) {
        return revokedAt == null && now.isBefore(expiresAt);
    }
}
