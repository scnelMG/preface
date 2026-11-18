package com.preface.common.deletion.entity;

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
 * 삭제 기록 겸 S3 삭제 재시도 큐. {@code PENDING} 행을 삭제 작업(스케줄러)이 집어 S3 객체를 지우고 {@code DONE}으로 바꾼다.
 *
 * <p>{@code target_type}·{@code reason}은 DDL에 CHECK가 없는 자유 문자열이라 상수로 둔다.
 */
@Getter
@Entity
@Table(name = "data_deletion_log")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class DataDeletionLog extends BaseTimeEntity {

    public static final String TARGET_FACE_UPLOAD = "FACE_UPLOAD";

    /** 결과 보고 전에 업로드한 생성 출력. presigned PUT 만료 뒤에만 삭제한다. */
    public static final String TARGET_RECON_OUTPUT = "RECON_OUTPUT";

    /** 복원 입력 프레임 묶음(V8). target_id = face_upload.id, object_key = 묶음 파일 하나(추출 시도마다 다른 key). */
    public static final String TARGET_FACE_UPLOAD_FRAMES = "FACE_UPLOAD_FRAMES";

    public static final String REASON_RETENTION_POLICY = "RETENTION_POLICY";
    public static final String REASON_WITHDRAWAL = "WITHDRAWAL";
    public static final String REASON_CONSENT_WITHDRAWN = "CONSENT_WITHDRAWN";
    public static final String STATUS_PENDING = "PENDING";

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(name = "user_id", nullable = false, length = 36, updatable = false)
    private String userId;

    @Column(nullable = false, length = 30)
    private String targetType;

    @Column(nullable = false, length = 36)
    private String targetId;

    @Column(length = 500)
    private String objectKey;

    @Column(nullable = false, length = 30)
    private String reason;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(nullable = false)
    private int retryCount;

    private Instant completedAt;

    public static DataDeletionLog pending(
            String userId, String targetType, String targetId, String objectKey, String reason) {
        DataDeletionLog log = new DataDeletionLog();
        log.userId = userId;
        log.targetType = targetType;
        log.targetId = targetId;
        log.objectKey = objectKey;
        log.reason = reason;
        log.status = STATUS_PENDING;
        return log;
    }
}
