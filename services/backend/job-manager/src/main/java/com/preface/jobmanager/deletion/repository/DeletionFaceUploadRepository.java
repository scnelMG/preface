package com.preface.jobmanager.deletion.repository;

import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.entity.FaceUploadStatus;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** 원본 영상 보관 만료 처리(FN-HIS-04). */
public interface DeletionFaceUploadRepository extends Repository<FaceUpload, String> {

    /**
     * 보관 시각이 지난 원본. 진행 중 작업의 입력이거나 이미 삭제 기록이 있는 것(성공 즉시 삭제·탈퇴 등으로 다른 곳이 남긴 것)은 뺀다. 인덱스 {@code
     * idx_upload_retention(status, retention_expires_at)}.
     */
    @Query(
            "select u from FaceUpload u where u.status in :statuses"
                    + " and u.retentionExpiresAt <= :now"
                    + " and not exists (select j.id from ReconstructionJob j"
                    + " where j.faceUploadId = u.id and j.status in :activeJobStatuses)"
                    + " and not exists (select l.id from DataDeletionLog l"
                    + " where l.targetType = :targetType and l.targetId = u.id)"
                    + " order by u.retentionExpiresAt, u.id")
    List<FaceUpload> findExpired(
            @Param("statuses") Collection<FaceUploadStatus> statuses,
            @Param("now") Instant now,
            @Param("activeJobStatuses") Collection<ReconstructionStatus> activeJobStatuses,
            @Param("targetType") String targetType,
            Pageable pageable);

    /**
     * 보관 시각이 지난 프레임 묶음(V8). 성공 작업은 결과 보고 때 이미 지웠으므로 실패·취소 작업의 것만 남는다. 진행 중 작업의 입력은 뺀다. 업로드 상태(원본 영상
     * 삭제 여부)와 무관하다 — 원본은 추출 직후 지워져 DELETED일 수 있다.
     */
    @Query(
            "select u from FaceUpload u where u.framesObjectKey is not null"
                    + " and u.retentionExpiresAt <= :now"
                    + " and not exists (select j.id from ReconstructionJob j"
                    + " where j.faceUploadId = u.id and j.status in :activeJobStatuses)"
                    + " order by u.retentionExpiresAt, u.id")
    List<FaceUpload> findExpiredFrameBundles(
            @Param("now") Instant now,
            @Param("activeJobStatuses") Collection<ReconstructionStatus> activeJobStatuses,
            Pageable pageable);

    /** S3 객체를 지운 뒤 업로드 행을 삭제됨으로 바꾸고 웹 녹화 촬영 기록(S15P31B204-640)도 비운다. 행이 없으면(탈퇴로 물리 삭제) 0. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            "update FaceUpload u set u.status = :deleted, u.deletedAt = :now, u.captureTrace = null"
                    + " where u.id = :id and u.status <> :deleted")
    int markDeleted(
            @Param("id") String id,
            @Param("deleted") FaceUploadStatus deleted,
            @Param("now") Instant now);
}
