package com.preface.jobmanager.deletion.repository;

import com.preface.common.notification.entity.Notification;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface DeletionNotificationRepository extends Repository<Notification, String> {

    /** 보관 기간(90일)이 지난 알림. 조회 API는 이미 숨기고 있어 지워도 화면 변화가 없다. */
    @Query("select n.id from Notification n where n.createdAt < :cutoff order by n.createdAt, n.id")
    List<String> findIdsCreatedBefore(@Param("cutoff") Instant cutoff, Pageable pageable);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from Notification n where n.id in :ids")
    int deleteAllByIdIn(@Param("ids") Collection<String> ids);
}
