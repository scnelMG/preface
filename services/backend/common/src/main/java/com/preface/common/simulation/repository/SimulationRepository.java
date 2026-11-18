package com.preface.common.simulation.repository;

import com.preface.common.simulation.entity.Simulation;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SimulationRepository extends JpaRepository<Simulation, String> {

    /** 본인 소유이고 삭제되지 않은 시안. 없거나 남의 것이면 비어 있다(호출한 쪽이 COMMON_002). */
    Optional<Simulation> findByIdAndUserIdAndDeletedAtIsNull(String id, String userId);

    /**
     * 편집용 조회. 행 잠금(SELECT … FOR UPDATE)으로 같은 시안의 편집을 한 줄로 세운다 — 동시에 온 두 요청 중 뒤의 것은 앞의 것이 끝난 뒤
     * stateVersion 비교에서 EDIT_002가 된다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select s from Simulation s"
                    + " where s.id = :id and s.userId = :userId and s.deletedAt is null")
    Optional<Simulation> findOwnedForUpdate(@Param("id") String id, @Param("userId") String userId);

    List<Simulation> findAllByFaceModelIdAndDeletedAtIsNullOrderById(String faceModelId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select s from Simulation s where s.faceModelId = :modelId and s.deletedAt is null order by s.id")
    List<Simulation> findActiveModelSimulationsForUpdate(@Param("modelId") String modelId);

    /** 이름 번호 매기기용. 같은 3D에서 {@code prefix}로 시작하는 시안 이름. */
    @Query(
            "select s.title from Simulation s where s.faceModelId = :faceModelId"
                    + " and s.deletedAt is null and s.title like concat(:prefix, '%')")
    List<String> findTitlesStartingWith(
            @Param("faceModelId") String faceModelId, @Param("prefix") String prefix);

    /** API-HIS-06. 본인의 변경 있는(빈 시안 제외) 삭제되지 않은 시안. */
    Page<Simulation> findByUserIdAndHasChangesTrueAndDeletedAtIsNull(
            String userId, Pageable pageable);

    /** API-HIS-06 {@code faceModelId} 필터. */
    Page<Simulation> findByUserIdAndFaceModelIdAndHasChangesTrueAndDeletedAtIsNull(
            String userId, String faceModelId, Pageable pageable);

    /** API-HIS-01 {@code simulationCount}. 3D별 [faceModelId, 개수] — 빈 시안·삭제된 시안 제외. */
    @Query(
            "select s.faceModelId, count(s) from Simulation s"
                    + " where s.faceModelId in :faceModelIds and s.hasChanges = true"
                    + " and s.deletedAt is null group by s.faceModelId")
    List<Object[]> countVisibleByFaceModelIds(
            @Param("faceModelIds") Collection<String> faceModelIds);

    /** API-HIS-03. 3D에 연결된 시안을 한 번에 소프트 삭제한다(빈 시안 포함). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(
            "update Simulation s set s.deletedAt = :now"
                    + " where s.faceModelId = :faceModelId and s.deletedAt is null")
    int softDeleteByFaceModelId(
            @Param("faceModelId") String faceModelId, @Param("now") Instant now);

    /** 탈퇴 때 물리 삭제. 영속성 컨텍스트에 남은 변경을 먼저 반영한다(flush). */
    @Modifying(flushAutomatically = true)
    @Query("delete from Simulation x where x.userId = :userId")
    int deleteAllByUserId(@Param("userId") String userId);
}
