package com.preface.common.consult.entity;

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

/**
 * 변경 요청(상담이 만든 편집 후보). {@code requestJson}에 후보 전체({@code actions[]}·{@code skipped[]})를,
 * 반영(API-EDIT-05) 뒤에는 {@code applyResult}까지 담는다. v2 요청은 여러 효과라 단일 조절용 {@code
 * sub_part/direction/degree} 컬럼은 비워 둔다.
 *
 * <p>ID는 상담 응답의 {@code requestId}로 먼저 알려야 해서 생성 때 정한다.
 */
@Getter
@Entity
@Table(name = "change_request")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ChangeRequest extends BaseTimeEntity {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 36, updatable = false)
    private String simulationId;

    @Column(nullable = false, length = 36, updatable = false)
    private String consultMessageId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ChangeRequestStatus status;

    /** EYE / NOSE. 효과가 두 부위에 걸치면 null(검색용 컬럼). */
    @Column(length = 20)
    private String part;

    @Column(nullable = false, columnDefinition = "json")
    private String requestJson;

    @Column(nullable = false, length = 20)
    private String requestSchemaVersion;

    private Instant appliedAt;

    public static ChangeRequest complete(
            String id,
            String simulationId,
            String consultMessageId,
            String part,
            String requestJson,
            String schemaVersion) {
        ChangeRequest request = new ChangeRequest();
        request.id = id;
        request.simulationId = simulationId;
        request.consultMessageId = consultMessageId;
        request.status = ChangeRequestStatus.COMPLETE;
        request.part = part;
        request.requestJson = requestJson;
        request.requestSchemaVersion = schemaVersion;
        return request;
    }

    /** API-EDIT-05 성공. {@code requestJson}은 {@code applyResult}를 더한 전체로 바꾼다. */
    public void markApplied(String requestJson, Instant now) {
        this.status = ChangeRequestStatus.APPLIED;
        this.requestJson = requestJson;
        this.appliedAt = now;
    }
}
