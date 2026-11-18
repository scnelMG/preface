package com.preface.common.facemodel.entity;

import com.preface.common.jpa.CreatedAtEntity;
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
 * 설문용 얼굴 사진(3D 1개당 5방향, 영구 보관). 워커 결과 보고(INT-REC-03) 때 3D와 같은 트랜잭션에서 만든다.
 *
 * <p>사용자에게는 FRONT 한 장만 본인 3D 결과 화면에서 presigned GET으로 보여 준다(S15P31B204-604, {@code GET
 * /face-models/{faceModelId}/front-photo}). LLM에는 보내지 않는다. 3D 행이 물리 삭제되면 FK CASCADE로 함께 지워진다(S3 객체는
 * 삭제 작업이 지운다).
 */
@Getter
@Entity
@Table(name = "face_capture_image")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class FaceCaptureImage extends CreatedAtEntity {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(name = "face_model_id", nullable = false, length = 36, updatable = false)
    private String faceModelId;

    @Column(name = "user_id", nullable = false, length = 36, updatable = false)
    private String userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10, updatable = false)
    private CaptureAngle angle;

    @Column(name = "object_key", nullable = false, length = 500, updatable = false)
    private String objectKey;

    public static FaceCaptureImage of(
            String faceModelId, String userId, CaptureAngle angle, String objectKey) {
        FaceCaptureImage image = new FaceCaptureImage();
        image.faceModelId = faceModelId;
        image.userId = userId;
        image.angle = angle;
        image.objectKey = objectKey;
        return image;
    }
}
