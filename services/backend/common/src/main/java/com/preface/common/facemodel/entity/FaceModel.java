package com.preface.common.facemodel.entity;

import com.preface.common.jpa.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
 * 3D 얼굴 모델(내 머리, Before). 복원 작업이 성공하면 결과 보고(INT-REC-03) 안에서 만든다.
 *
 * <p>사용자가 지우면 {@code deleted_at} 소프트 삭제 후 30일 뒤 물리 삭제(FN-HIS-03). 조회 때는 {@code deleted_at IS NULL}을
 * 꼭 건다.
 */
@Getter
@Entity
@Table(name = "face_model")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class FaceModel extends BaseTimeEntity {
    public static final String BASELINE_REVIEW_KEY = "approvedBaselineReviewV1";

    /** DDL 기본값과 같다. 번호 붙이기([제안])는 내 머리 목록 작업에서 정한다. */
    public static final String DEFAULT_TITLE = "내 머리";

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(name = "user_id", nullable = false, length = 36, updatable = false)
    private String userId;

    @Column(name = "reconstruction_job_id", nullable = false, length = 36, updatable = false)
    private String reconstructionJobId;

    @Column(nullable = false, length = 500)
    private String meshObjectKey;

    @Column(name = "source_mesh_object_key", length = 500)
    private String sourceMeshObjectKey;

    @Column(name = "previous_mesh_object_key", length = 500)
    private String previousMeshObjectKey;

    @Column(length = 500)
    private String rigObjectKey;

    @Column(name = "source_rig_object_key", length = 500)
    private String sourceRigObjectKey;

    /**
     * 표정 트래킹 리그(S15P31B204-879). 코·눈 승인이 해시로 묶인 리그({@code rig_object_key})와 따로 둔다. 없으면 편집실 표정 트래킹을
     * 켜지 않는다.
     */
    @Column(length = 500)
    private String expressionObjectKey;

    @Column(length = 500)
    private String textureObjectKey;

    @Column(length = 500)
    private String thumbnailObjectKey;

    @Column(nullable = false, length = 10)
    private String meshFormat;

    @Column(nullable = false, length = 20)
    private String morphSchemaVersion;

    /**
     * 채팅 적용(API-EDIT-05) 허용. 생성 때는 항상 false이고, 모델별 지원 코드·좌우·범위와 리그 버전이 검증되고 서버 최종 형상 검사 경로가 준비된 모델만
     * true로 둔다. 신규 생성은 모델 등록과 같은 거래에서 검증·승인한다.
     */
    @Column(nullable = false)
    private boolean chatApplyReady;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "approved_nose_capabilities")
    private String approvedNoseCapabilities;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "eye_review")
    private String eyeReview;

    @Column(name = "eye_parts_sha256", length = 64)
    private String eyePartsSha256;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "approved_eye_capabilities")
    private String approvedEyeCapabilities;

    /** Same uploaded GLB and fit as approved_nose_capabilities; absent means unsupported. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "approved_weight_shape")
    private String approvedWeightShape;

    @JdbcTypeCode(SqlTypes.JSON)
    private String editApprovalRetry;

    private Instant editApprovalRetryAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "measurements")
    private String measurementsJson;

    /** 워커가 추정한 머리 속성(S15P31B204-551). 헤어 템플릿 추천 전용. 없으면 추천하지 않는다. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "hair_meta")
    private String hairMetaJson;

    @Column(nullable = false, length = 100)
    private String title;

    private Instant deletedAt;

    public static FaceModel create(
            String userId,
            String reconstructionJobId,
            String meshObjectKey,
            String rigObjectKey,
            String expressionObjectKey,
            String textureObjectKey,
            String thumbnailObjectKey,
            String meshFormat,
            String morphSchemaVersion,
            String measurementsJson) {
        FaceModel model = new FaceModel();
        model.userId = userId;
        model.reconstructionJobId = reconstructionJobId;
        model.meshObjectKey = meshObjectKey;
        model.rigObjectKey = rigObjectKey;
        model.expressionObjectKey = expressionObjectKey;
        model.textureObjectKey = textureObjectKey;
        model.thumbnailObjectKey = thumbnailObjectKey;
        model.meshFormat = meshFormat;
        model.morphSchemaVersion = morphSchemaVersion;
        model.measurementsJson = measurementsJson;
        model.title = DEFAULT_TITLE;
        return model;
    }

    public boolean isDeleted() {
        return deletedAt != null;
    }

    /** 검증된 원본·리그와 코 범위가 같은 모델일 때만 편집을 연다. */
    public void approveNose(String capabilitiesJson) {
        this.approvedNoseCapabilities = capabilitiesJson;
        this.chatApplyReady = true;
    }

    public void revokeNose() {
        this.chatApplyReady = false;
        this.approvedNoseCapabilities = null;
    }

    public void upgradeNoseRig(String newRigKey, String noseApproval, String eyeApproval) {
        if (this.sourceRigObjectKey == null) {
            this.sourceRigObjectKey = this.rigObjectKey;
        }
        this.rigObjectKey = newRigKey;
        approveNose(noseApproval);
        approveEyes(eyeApproval);
    }

    /** 기존 모델에 표정 트래킹 리그를 보충한다(S15P31B204-879). key 검사는 호출한 쪽이 한다. 다른 승인·시안 상태는 그대로다. */
    public void attachExpressionRig(String objectKey) {
        this.expressionObjectKey = objectKey;
    }

    /** 판정이 없는 기존 모델과 작업 결과는 눈 편집을 열지 않는다. */
    public void recordEyeReview(String reviewJson, String partsSha256) {
        this.eyeReview = reviewJson;
        this.eyePartsSha256 = partsSha256;
    }

    /** 형식 검사는 호출한 쪽이 한다. */
    public void recordHairMeta(String hairMetaJson) {
        this.hairMetaJson = hairMetaJson;
    }

    /** 원본과 리그 결속이 검증된 분석 기록을 기존 측정 JSON에 추가한다. */
    public void recordMeasurements(String measurementsJson) {
        this.measurementsJson = measurementsJson;
    }

    /** 워커가 잰 눈 승인 한계. 결속 검사는 호출한 쪽이 한다(S15P31B204-521). */
    public void approveEyes(String capabilitiesJson) {
        this.approvedEyeCapabilities = capabilitiesJson;
    }

    public void approveWeightShape(String capabilitiesJson) {
        this.approvedWeightShape = capabilitiesJson;
    }

    public void scheduleEditApprovalRetry(String candidateJson, Instant retryAt) {
        this.editApprovalRetry = candidateJson;
        this.editApprovalRetryAt = retryAt;
    }

    /** 검증한 새 GLB로 한 번만 전환한다. 이전 키는 삭제·탈퇴까지 함께 추적한다. */
    public void activateWeightShapeMesh(
            String expectedMeshKey,
            String newMeshKey,
            String noseApprovalJson,
            String weightApprovalJson) {
        if (!java.util.Objects.equals(meshObjectKey, expectedMeshKey)
                || sourceMeshObjectKey != null
                || newMeshKey == null
                || newMeshKey.equals(expectedMeshKey)) {
            throw new IllegalStateException("invalid face model backfill state");
        }
        sourceMeshObjectKey = meshObjectKey;
        replaceMesh(newMeshKey, noseApprovalJson, weightApprovalJson);
    }

    public void activateContourRecovery(
            String expectedMeshKey,
            String newMeshKey,
            String noseApprovalJson,
            String weightApprovalJson) {
        if (!java.util.Objects.equals(meshObjectKey, expectedMeshKey)
                || sourceMeshObjectKey == null
                || previousMeshObjectKey != null
                || newMeshKey == null
                || newMeshKey.equals(expectedMeshKey)
                || newMeshKey.equals(sourceMeshObjectKey)) {
            throw new IllegalStateException("invalid contour recovery state");
        }
        previousMeshObjectKey = meshObjectKey;
        replaceMesh(newMeshKey, noseApprovalJson, weightApprovalJson);
    }

    private void replaceMesh(
            String newMeshKey, String noseApprovalJson, String weightApprovalJson) {
        meshObjectKey = newMeshKey;
        approvedNoseCapabilities = noseApprovalJson;
        chatApplyReady = noseApprovalJson != null;
        approvedEyeCapabilities = null;
        approvedWeightShape = weightApprovalJson;
    }

    /** 이름 바꾸기(S15P31B204-399). 검증(1~20자, 앞뒤 공백 제거)은 호출한 쪽이 한다. */
    public void rename(String title) {
        this.title = title;
    }

    /**
     * 브라우저가 원본 3D를 렌더링해 올린 썸네일(S15P31B204-436). GPU 워커가 썸네일을 만들지 않아 비어 있을 때만 채운다(먼저 저장된 것 유지). 채웠으면
     * true.
     */
    public boolean attachThumbnail(String objectKey) {
        if (thumbnailObjectKey != null) {
            return false;
        }
        thumbnailObjectKey = objectKey;
        return true;
    }

    /** API-HIS-03. 사용자 조회에서 바로 빠지고, 30일 뒤 배치가 물리 삭제한다. */
    public void softDelete(Instant now) {
        this.deletedAt = now;
    }
}
