package com.preface.common.facemodel.repository;

import com.preface.common.facemodel.entity.FaceModel;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FaceModelRepository extends JpaRepository<FaceModel, String> {

    /** 작업 하나에 모델 하나({@code uk_face_model_job}). 지운 모델도 찾는다(결과 보고 멱등 처리용). */
    Optional<FaceModel> findByReconstructionJobId(String reconstructionJobId);

    /** API-HIS-01. 본인의 삭제되지 않은 3D. */
    Page<FaceModel> findByUserIdAndDeletedAtIsNull(String userId, Pageable pageable);

    /** API-HIS-02. 없거나 남의 것·삭제된 것이면 비어 있다(호출한 쪽이 COMMON_002). */
    Optional<FaceModel> findByIdAndUserIdAndDeletedAtIsNull(String id, String userId);

    /**
     * API-HIS-03 삭제용 조회. 행을 잠가 시안 생성(API-EDIT-02, 같은 행을 FOR UPDATE)과 한 줄로 세운다 — 삭제가 먼저 끝나면 생성은
     * HIS_002가 된다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select m from FaceModel m"
                    + " where m.id = :id and m.userId = :userId and m.deletedAt is null")
    Optional<FaceModel> findOwnedForUpdate(@Param("id") String id, @Param("userId") String userId);

    /** 내부 원본 측정 등록은 삭제와 모델 교체에 사용하는 동일한 행을 잠근다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<FaceModel> findByIdAndDeletedAtIsNull(String id);

    @Query(
            "select m.id from FaceModel m where m.deletedAt is null and m.editApprovalRetryAt <= :now"
                    + " order by m.editApprovalRetryAt")
    List<String> findDueEditApprovalRetries(@Param("now") Instant now, Pageable pageable);

    boolean existsByIdAndEditApprovalRetryAtIsNotNull(String id);

    /** 소프트 삭제된 모델도 포함한다(탈퇴는 유예 없는 하드 삭제, FN-AUTH-04 수용 3). */
    List<FaceModel> findAllByUserId(String userId);

    /** 탈퇴 때 물리 삭제. 영속성 컨텍스트에 남은 변경을 먼저 반영한다(flush). */
    @Modifying(flushAutomatically = true)
    @Query("delete from FaceModel x where x.userId = :userId")
    int deleteAllByUserId(@Param("userId") String userId);
}
