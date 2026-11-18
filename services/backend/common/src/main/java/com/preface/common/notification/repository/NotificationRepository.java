package com.preface.common.notification.repository;

import com.preface.common.notification.entity.Notification;
import java.time.Instant;
import java.util.Collection;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 보관 기간 밖(cutoff 이전) 알림은 모든 조회·읽음 처리에서 뺀다. */
public interface NotificationRepository extends JpaRepository<Notification, String> {

    Page<Notification> findByUserIdAndCreatedAtGreaterThanEqual(
            String userId, Instant cutoff, Pageable pageable);

    long countByUserIdAndReadAtIsNullAndCreatedAtGreaterThanEqual(String userId, Instant cutoff);

    /** 본인 알림만 바꾼다. 타인·없는 ID는 조건에 걸리지 않아 무시된다. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            "update Notification n set n.readAt = :now, n.updatedAt = :now"
                    + " where n.userId = :userId and n.id in :ids and n.readAt is null"
                    + " and n.createdAt >= :cutoff")
    int markRead(
            @Param("userId") String userId,
            @Param("ids") Collection<String> ids,
            @Param("now") Instant now,
            @Param("cutoff") Instant cutoff);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(
            "update Notification n set n.readAt = :now, n.updatedAt = :now"
                    + " where n.userId = :userId and n.readAt is null and n.createdAt >= :cutoff")
    int markAllRead(
            @Param("userId") String userId,
            @Param("now") Instant now,
            @Param("cutoff") Instant cutoff);

    /** 탈퇴 때 물리 삭제. 영속성 컨텍스트에 남은 변경을 먼저 반영한다(flush). */
    @Modifying(flushAutomatically = true)
    @Query("delete from Notification x where x.userId = :userId")
    int deleteAllByUserId(@Param("userId") String userId);
}
