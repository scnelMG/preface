package com.preface.jobmanager.deletion.repository;

import com.preface.common.simulation.entity.Simulation;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * 시안 물리 삭제(FN-HIS-03·05). 대상 행을 잠그고(FOR UPDATE) 지운다 — 같은 순간 편집 API가 빈 시안을 바꾸면(has_changes=1) 편집이 먼저
 * 끝나거나, 삭제가 먼저 끝나 편집이 404가 된다. 상담 메시지·변경 요청·변경 이력은 FK {@code ON DELETE CASCADE}로 함께 지워진다.
 */
public interface DeletionSimulationRepository extends Repository<Simulation, String> {

    /** 빈 시안(생성 뒤 편집·대화 없음). 인덱스 {@code idx_sim_empty_cleanup(has_changes, created_at)}. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select s from Simulation s where s.hasChanges = false and s.createdAt < :cutoff"
                    + " order by s.createdAt, s.id")
    List<Simulation> lockEmptyCreatedBefore(@Param("cutoff") Instant cutoff, Pageable pageable);

    /** 소프트 삭제 뒤 보관 기간이 지난 시안. 인덱스 {@code idx_sim_deleted}. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Simulation s where s.deletedAt < :cutoff order by s.deletedAt, s.id")
    List<Simulation> lockSoftDeletedBefore(@Param("cutoff") Instant cutoff, Pageable pageable);

    /** 3D 물리 삭제 때 CASCADE로 함께 지워질 시안(기록용). */
    @Query("select s from Simulation s where s.faceModelId in :faceModelIds")
    List<Simulation> findAllByFaceModelIdIn(@Param("faceModelIds") Collection<String> faceModelIds);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from Simulation s where s.id in :ids")
    int deleteAllByIdIn(@Param("ids") Collection<String> ids);
}
