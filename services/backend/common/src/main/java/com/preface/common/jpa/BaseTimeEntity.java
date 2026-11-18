package com.preface.common.jpa;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;
import lombok.Getter;
import org.springframework.data.annotation.LastModifiedDate;

/**
 * {@code created_at}·{@code updated_at}이 있는 테이블용.
 *
 * <p>주의: {@code @LastModifiedDate}는 엔티티 값이 실제로 바뀔 때만 갱신된다. 값 변경 없이 "활동 시각"만 올려야 하면(예: 상담 메시지만 추가된
 * 시안) {@link #touch()}를 호출한다.
 */
@Getter
@MappedSuperclass
public abstract class BaseTimeEntity extends CreatedAtEntity {

    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected void touch() {
        this.updatedAt = Instant.now();
    }
}
