package com.preface.common.simulation.entity;

import com.preface.common.jpa.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

/**
 * 가중치 변경 이력 한 단계. {@code stateAfter}에 변경 후 가중치 전체를 저장해 undo·redo가 포인터 이동 + 한 행 조회로 끝난다(ERD 설명
 * "undo·redo = morph_change 스택").
 */
@Getter
@Entity
@Table(name = "morph_change")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MorphChange extends BaseTimeEntity {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 36)
    private String simulationId;

    @Column(nullable = false)
    private int seq;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private MorphChangeSource source;

    @Column(length = 36)
    private String changeRequestId;

    @Column(columnDefinition = "json")
    private String delta;

    @Column(nullable = false, columnDefinition = "json")
    private String stateAfter;

    @Column(nullable = false)
    private boolean clamped;

    @Column(length = 300)
    private String summary;

    public static MorphChange record(
            String simulationId,
            int seq,
            MorphChangeSource source,
            String delta,
            String stateAfter,
            boolean clamped,
            String summary) {
        return record(simulationId, seq, source, null, delta, stateAfter, clamped, summary);
    }

    /** 상담 반영(source=CHAT)은 근거 변경 요청 ID를 함께 남긴다. */
    public static MorphChange record(
            String simulationId,
            int seq,
            MorphChangeSource source,
            String changeRequestId,
            String delta,
            String stateAfter,
            boolean clamped,
            String summary) {
        MorphChange change = new MorphChange();
        change.changeRequestId = changeRequestId;
        change.simulationId = simulationId;
        change.seq = seq;
        change.source = source;
        change.delta = delta;
        change.stateAfter = stateAfter;
        change.clamped = clamped;
        change.summary = summary;
        return change;
    }
}
