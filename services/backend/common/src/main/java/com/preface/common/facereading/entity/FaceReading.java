package com.preface.common.facereading.entity;

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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

/**
 * AI 관상(재미용, S15P31B204-438). 3D 생성 작업 1개당 1건이고, 결과 글(JSON)만 보관한다. 사진은 저장하지 않는다.
 *
 * <p>작업 행이 물리 삭제되면(탈퇴 등) FK CASCADE로 함께 지워진다. 실패(FAILED)나 오래 멈춘 PENDING은 같은 행을 다시 시도한다.
 */
@Getter
@Entity
@Table(name = "face_reading")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class FaceReading extends BaseTimeEntity {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(name = "user_id", nullable = false, length = 36, updatable = false)
    private String userId;

    @Column(name = "reconstruction_job_id", nullable = false, length = 36, updatable = false)
    private String reconstructionJobId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private FaceReadingStatus status;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "json")
    private String result;

    @Column(name = "fail_code", length = 30)
    private String failCode;

    @Column(length = 50)
    private String model;

    public static FaceReading pending(String userId, String reconstructionJobId) {
        FaceReading reading = new FaceReading();
        reading.userId = userId;
        reading.reconstructionJobId = reconstructionJobId;
        reading.status = FaceReadingStatus.PENDING;
        return reading;
    }

    /** 실패했거나 오래 멈춘 요청을 다시 시작한다. 이전 결과·실패 사유는 지운다. */
    public void restart() {
        status = FaceReadingStatus.PENDING;
        result = null;
        failCode = null;
        model = null;
    }

    public void complete(String resultJson, String model) {
        status = FaceReadingStatus.DONE;
        result = resultJson;
        failCode = null;
        this.model = model;
    }

    public void fail(String failCode) {
        status = FaceReadingStatus.FAILED;
        this.failCode = failCode;
    }

    /** PENDING인데 마지막 변경이 기준보다 오래됐으면(서버 재시작 등으로 작업이 사라진 경우) 멈춘 것으로 본다. */
    public boolean stalledBefore(Instant threshold) {
        return status == FaceReadingStatus.PENDING
                && getUpdatedAt() != null
                && getUpdatedAt().isBefore(threshold);
    }
}
