package com.preface.jobmanager.deletion.repository;

import com.preface.common.deletion.entity.DataDeletionLog;
import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * 삭제 작업이 쓰는 {@code data_deletion_log} 접근. 상태 변경은 bulk update로 한다(엔티티에 변경 메서드를 두지 않아 다른 작업과 common
 * 충돌을 줄인다). {@code updated_at}은 DDL의 {@code ON UPDATE CURRENT_TIMESTAMP}가 채운다. 호출한 쪽 트랜잭션 안에서 부른다.
 */
public interface DeletionLogRepository extends Repository<DataDeletionLog, String> {

    DataDeletionLog save(DataDeletionLog log);

    /** 실패가 적은 행부터(같으면 오래된 순). 계속 실패하는 key가 새 행을 막지 않게 한다. */
    @Query(
            "select l from DataDeletionLog l where l.status = :status"
                    + " and (l.targetType <> :delayedType or l.createdAt <= :eligibleBefore)"
                    + " order by l.retryCount, l.createdAt, l.id")
    List<DataDeletionLog> findEligible(
            @Param("status") String status,
            @Param("delayedType") String delayedType,
            @Param("eligibleBefore") Instant eligibleBefore,
            Pageable pageable);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            "update DataDeletionLog l set l.status = :done, l.completedAt = :now"
                    + " where l.id = :id and l.status = :pending")
    int markDone(
            @Param("id") String id,
            @Param("now") Instant now,
            @Param("done") String done,
            @Param("pending") String pending);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            "update DataDeletionLog l set l.retryCount = :retryCount, l.status = :status"
                    + " where l.id = :id and l.status = :pending")
    int recordFailure(
            @Param("id") String id,
            @Param("retryCount") int retryCount,
            @Param("status") String status,
            @Param("pending") String pending);
}
