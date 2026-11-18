package com.preface.common.consult.entity;

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
 * 상담 메시지 한 건. 사용자 원문은 저장하지 않고 AI가 돌려준 마스킹본({@code maskedUserContent})만 저장한다(API-CON-01 비고).
 *
 * <p>{@code seq}는 시안 안에서 1부터 빈틈없이 오른다. 사용자·도우미 메시지를 한 트랜잭션에서 n+1·n+2로 넣는다. {@code options}는 되묻기 선택지
 * JSON(선택지 ID·라벨·후보 효과·묶인 {@code stateVersion})이다.
 */
@Getter
@Entity
@Table(name = "consult_message")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ConsultMessage extends BaseTimeEntity {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 36, updatable = false)
    private String simulationId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20, updatable = false)
    private ConsultRole role;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(nullable = false)
    private boolean masked;

    @Column(length = 20)
    private String intent;

    @Column(nullable = false)
    private boolean needsClarification;

    @Column(columnDefinition = "json")
    private String options;

    @Column(nullable = false)
    private boolean filtered;

    @Column(nullable = false, updatable = false)
    private int seq;

    public static ConsultMessage user(
            String simulationId, int seq, String content, boolean masked) {
        ConsultMessage message = new ConsultMessage();
        message.simulationId = simulationId;
        message.role = ConsultRole.USER;
        message.seq = seq;
        message.content = content;
        message.masked = masked;
        return message;
    }

    public static ConsultMessage assistant(
            String simulationId,
            int seq,
            String content,
            String intent,
            boolean needsClarification,
            String options,
            boolean filtered) {
        ConsultMessage message = new ConsultMessage();
        message.simulationId = simulationId;
        message.role = ConsultRole.ASSISTANT;
        message.seq = seq;
        message.content = content;
        message.intent = intent;
        message.needsClarification = needsClarification;
        message.options = options;
        message.filtered = filtered;
        return message;
    }
}
