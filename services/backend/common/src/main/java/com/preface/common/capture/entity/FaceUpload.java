package com.preface.common.capture.entity;

import com.preface.common.jpa.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 얼굴 영상 업로드(API-CAP-01이 만든다). 파일 바이트는 서버를 거치지 않고 presigned PUT으로 S3에 바로 올라간다.
 *
 * <p>ID를 생성기 대신 직접 넣는 이유: S3 key({@code users/{userId}/uploads/{id}.{ext}})에 ID가 들어가서 저장 전에 알아야 한다.
 *
 * <p>{@code video_meta}(워커가 채움)는 아직 매핑하지 않는다.
 */
@Getter
@Entity
@Table(name = "face_upload")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class FaceUpload extends BaseTimeEntity {

    /** 원본 보관 기본값: URL 만료 + 24시간(V1 DDL 주석 S-04). 복원 결과가 나오면 REC 쪽에서 다시 정한다. */
    public static final Duration DEFAULT_RETENTION_AFTER_URL_EXPIRY = Duration.ofHours(24);

    /**
     * multipart로 올린 영상(S15P31B204-506)의 S3 사용자 메타데이터 키. 값은 선언한 조각 체크섬으로 계산한 composite
     * SHA-256({@code base64-조각수})이다. S3는 multipart 객체의 체크섬을 composite로만 주므로 완료 확인(REC-01)은 전체
     * SHA-256 대신 이 값과 비교한다. 업로드 시작 때 서버가 넣고 클라이언트는 바꿀 수 없다.
     */
    public static final String EXPECTED_COMPOSITE_CHECKSUM_META = "expected-checksum-sha256";

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 36)
    private String userId;

    /** 원본 영상 key. 프레임 추출이 끝나면 NULL(V8 — 삭제할 key는 data_deletion_log에 남는다). */
    @Column(length = 500)
    private String objectKey;

    @Column(nullable = false, length = 50)
    private String contentType;

    /** 프레임 묶음 key(V8). 3D 생성이 끝나 삭제를 예약하면 NULL. */
    @Column(length = 500)
    private String framesObjectKey;

    @Column(nullable = false)
    private long sizeBytes;

    @Column(nullable = false)
    private int durationMs;

    @Column(nullable = false, length = 44)
    private String checksumSha256;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private FaceUploadStatus status;

    @Column(nullable = false)
    private Instant urlExpiresAt;

    private Instant uploadedAt;

    @Column(nullable = false)
    private Instant retentionExpiresAt;

    /** 웹 녹화·파일 올리기(S15P31B204-617). 예전 업로드는 null */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private CaptureMethod captureMethod;

    /** FE가 아는 기종. 사용자가 고른 값일 수 있어 렌즈 출발값으로만 쓴다(S15P31B204-617) */
    @Column(length = 100)
    private String deviceModel;

    /**
     * 웹 녹화 촬영 기록 JSON(S15P31B204-640). 서버는 해석하지 않고 추출 워커에 넘긴다. 원본 영상을 지우면 함께 지운다. 모양: {@code
     * contracts/frame-extraction/schemas/claim-response.schema.json}의 {@code capture.trace}
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "capture_trace")
    private String captureTrace;

    private Instant deletedAt;

    /** 프레임 묶음 삭제를 예약한 뒤 주소를 지운다(key는 data_deletion_log에 남는다). */
    public void clearFrames() {
        framesObjectKey = null;
    }

    public static FaceUpload issue(
            String id,
            String userId,
            String objectKey,
            String contentType,
            long sizeBytes,
            int durationMs,
            String checksumSha256,
            Instant urlExpiresAt) {
        FaceUpload upload = new FaceUpload();
        upload.id = id;
        upload.userId = userId;
        upload.objectKey = objectKey;
        upload.contentType = contentType;
        upload.sizeBytes = sizeBytes;
        upload.durationMs = durationMs;
        upload.checksumSha256 = checksumSha256;
        upload.status = FaceUploadStatus.ISSUED;
        upload.urlExpiresAt = urlExpiresAt;
        upload.retentionExpiresAt = urlExpiresAt.plus(DEFAULT_RETENTION_AFTER_URL_EXPIRY);
        return upload;
    }

    /** 촬영 방식과 기종을 남긴다(둘 다 없으면 그대로 null). */
    public void recordCapture(CaptureMethod method, String model) {
        recordCapture(method, model, null);
    }

    /** 촬영 방식·기종·검사를 통과한 촬영 기록 JSON(없으면 null)을 남긴다. */
    public void recordCapture(CaptureMethod method, String model, String traceJson) {
        this.captureMethod = method;
        this.deviceModel = model == null || model.isBlank() ? null : model.strip();
        this.captureTrace = traceJson;
    }
}
