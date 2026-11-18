package com.preface.common.simulation.entity;

import com.preface.common.jpa.BaseTimeEntity;
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
 * 시안(자동 저장 단일 행). {@code morphState}는 현재 가중치 전체 JSON, {@code currentSeq}는 {@code morph_change.seq}를
 * 가리키는 undo·redo 포인터, {@code stateVersion}은 편집마다 1씩 오르는 낙관적 잠금 값이다.
 *
 * <p>{@code hairTemplateId}(2차, API-HAIR-02)는 적용한 헤어 템플릿이다. undo 대상이 아니고 가중치·버전과 따로 바뀐다.
 */
@Getter
@Entity
@Table(name = "simulation")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Simulation extends BaseTimeEntity {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 36)
    private String userId;

    @Column(nullable = false, length = 36)
    private String faceModelId;

    @Column(nullable = false, length = 100)
    private String title;

    @Column(nullable = false, columnDefinition = "json")
    private String morphState;

    @Column(nullable = false)
    private int currentSeq;

    @Column(nullable = false)
    private int stateVersion;

    @Column(nullable = false)
    private int consultAfterSeq;

    @Column(nullable = false)
    private boolean hasChanges;

    @Column(length = 36)
    private String hairTemplateId;

    private Instant deletedAt;

    /** 빈 시안. seq 0(INIT) 이력은 호출한 쪽이 함께 저장한다. */
    public static Simulation create(
            String userId, String faceModelId, String title, String morphState) {
        Simulation simulation = new Simulation();
        simulation.userId = userId;
        simulation.faceModelId = faceModelId;
        simulation.title = title;
        simulation.morphState = morphState;
        return simulation;
    }

    public boolean isStateVersion(int expected) {
        return stateVersion == expected;
    }

    public void invalidateEditorVersion() {
        stateVersion++;
    }

    /** 편집·undo·redo·reset 공통: 상태와 포인터를 옮기고 버전을 올린다. 성공한 편집이므로 빈 시안이 아니게 된다. */
    public void moveTo(String morphState, int seq) {
        this.morphState = morphState;
        this.currentSeq = seq;
        this.stateVersion++;
        this.hasChanges = true;
    }

    /**
     * API-CON-01. 대화만 있어도 시안을 갱신한다(최근 기록 순서·빈 시안 제외에 반영). 가중치·버전은 그대로라 {@code touch()}로 수정 시각을 올린다.
     */
    public void markConversation() {
        this.hasChanges = true;
        touch();
    }

    public void startConversation(int lastMessageSeq) {
        consultAfterSeq = lastMessageSeq;
    }

    /** API-HIS-05. 이름만 바꾼다(가중치·버전·빈 시안 여부는 그대로). */
    public void rename(String title) {
        this.title = title;
    }

    /**
     * API-HAIR-02. 헤어 적용({@code null}이면 해제). 가중치·undo 포인터·{@code stateVersion}은 그대로 두고, 편집으로 보아 빈
     * 시안에서 벗어난다.
     */
    public void applyHair(String hairTemplateId) {
        this.hairTemplateId = hairTemplateId;
        this.hasChanges = true;
        touch();
    }

    /** API-HIS-07. 변경 있는 시안의 소프트 삭제. 빈 시안은 호출한 쪽이 물리 삭제한다. */
    public void softDelete(Instant now) {
        this.deletedAt = now;
    }
}
