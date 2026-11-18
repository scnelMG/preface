package com.preface.common.admin.entity;

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
import org.hibernate.annotations.UuidGenerator;

/**
 * 관리자 조회 기록(REQ-N-27, V27). 추가만 하고 고치지 않는다(모든 컬럼 {@code updatable = false}).
 *
 * <p>회원 ID 두 개는 FK가 없다. 회원 행이 물리 삭제돼도 기록은 남는다. 서명 URL·이메일은 넣지 않는다.
 */
@Getter
@Entity
@Table(name = "admin_access_log")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AdminAccessLog {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 36, updatable = false)
    private String adminUserId;

    @Column(length = 36, updatable = false)
    private String targetUserId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30, updatable = false)
    private AdminAccessTargetType targetType;

    @Column(length = 36, updatable = false)
    private String targetId;

    @Column(nullable = false, length = 255, updatable = false)
    private String requestPath;

    @Column(nullable = false, updatable = false)
    private Instant accessedAt;

    public static AdminAccessLog of(
            String adminUserId,
            String targetUserId,
            AdminAccessTargetType targetType,
            String targetId,
            String requestPath,
            Instant accessedAt) {
        AdminAccessLog log = new AdminAccessLog();
        log.adminUserId = adminUserId;
        log.targetUserId = targetUserId;
        log.targetType = targetType;
        log.targetId = targetId;
        log.requestPath = requestPath;
        log.accessedAt = accessedAt;
        return log;
    }
}
