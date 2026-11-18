package com.preface.common.admin.repository;

import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * 관리자 페이지의 회원별 3D·저장 목록 조회(S15P31B204-653). 읽기만 한다.
 *
 * <p>기존 도메인 저장소에 관리자용 메서드를 섞지 않으려고 따로 둔다. 일반 사용자 조회와 달리 소프트 삭제된 행도 포함한다.
 */
public interface AdminUserDataRepository extends Repository<FaceModel, String> {

    /** 한 회원의 3D 목록(삭제된 것 포함), 최신순. 작업 상태·원본 영상 길이를 한 번에 붙인다. */
    @Query(
            value =
                    "select m.id as faceModelId, m.reconstructionJobId as jobId,"
                            + " m.createdAt as createdAt, u.durationMs as videoDurationMs,"
                            + " j.status as jobStatus, m.deletedAt as deletedAt"
                            + " from FaceModel m"
                            + " left join ReconstructionJob j on j.id = m.reconstructionJobId"
                            + " left join FaceUpload u on u.id = j.faceUploadId"
                            + " where m.userId = :userId"
                            + " order by m.createdAt desc, m.id desc",
            countQuery = "select count(m) from FaceModel m where m.userId = :userId")
    Page<FaceModelRow> findFaceModelsByUserId(@Param("userId") String userId, Pageable pageable);

    /** 3D별 시안 수(삭제된 시안·빈 시안 포함, DB에 남은 행 전부). [faceModelId, count] */
    @Query(
            "select s.faceModelId, count(s) from Simulation s"
                    + " where s.faceModelId in :faceModelIds group by s.faceModelId")
    List<Object[]> countSimulationsByFaceModelIds(
            @Param("faceModelIds") Collection<String> faceModelIds);

    /** 한 회원의 업로드 전부(원본 영상·프레임 묶음 key 대조용). */
    @Query("select u from FaceUpload u where u.userId = :userId")
    List<FaceUpload> findUploadsByUserId(@Param("userId") String userId);

    /** 한 회원 작업의 단계 로그 key. [logObjectKey, jobId] */
    @Query(
            "select s.logObjectKey, s.jobId from ReconstructionJobStage s, ReconstructionJob j"
                    + " where j.id = s.jobId and j.userId = :userId and s.logObjectKey is not null")
    List<Object[]> findStageLogKeysByUserId(@Param("userId") String userId);

    /** 한 회원의 아직 끝나지 않은 S3 삭제 기록(key가 있는 것만), 오래된 순. */
    @Query(
            "select d from DataDeletionLog d"
                    + " where d.userId = :userId and d.status in :statuses and d.objectKey is not null"
                    + " order by d.createdAt asc, d.id asc")
    List<DataDeletionLog> findDeletionLogs(
            @Param("userId") String userId, @Param("statuses") Collection<String> statuses);

    /** 3D 목록 한 줄. */
    interface FaceModelRow {
        String getFaceModelId();

        String getJobId();

        Instant getCreatedAt();

        Integer getVideoDurationMs();

        ReconstructionStatus getJobStatus();

        Instant getDeletedAt();
    }
}
