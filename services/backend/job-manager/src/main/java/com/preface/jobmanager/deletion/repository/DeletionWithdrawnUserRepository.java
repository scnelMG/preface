package com.preface.jobmanager.deletion.repository;

import com.preface.common.user.entity.User;
import com.preface.common.user.entity.UserStatus;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** 탈퇴 뒤 분리 보관 기간이 끝난 회원의 남은 기록(동의 이력·삭제 기록·식별자 행) 정리. */
public interface DeletionWithdrawnUserRepository extends Repository<User, String> {

    /**
     * 탈퇴 뒤 보관 기간이 지났고, 끝나지 않은 S3 삭제(PENDING·FAILED)가 없는 회원. 삭제가 남아 있으면 그 기록이 처리·확인될 때까지 둔다 — 기록을 먼저
     * 지우면 무엇을 지워야 하는지 잃는다.
     */
    @Query(
            "select u.id from User u where u.status = :withdrawn and u.deletedAt <= :before"
                    + " and not exists (select l.id from DataDeletionLog l"
                    + " where l.userId = u.id and l.status <> :done)"
                    + " order by u.deletedAt, u.id")
    List<String> findPurgeable(
            @Param("withdrawn") UserStatus withdrawn,
            @Param("before") Instant before,
            @Param("done") String done,
            Pageable pageable);

    @Modifying(flushAutomatically = true)
    @Query("delete from UserConsent c where c.user.id in :ids")
    int deleteConsents(@Param("ids") Collection<String> ids);

    @Modifying(flushAutomatically = true)
    @Query("delete from DataDeletionLog l where l.userId in :ids")
    int deleteDeletionLogs(@Param("ids") Collection<String> ids);

    /** 회원 행. social_account·notification은 DB CASCADE(탈퇴 때 이미 비어 있다). */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from User u where u.id in :ids")
    int deleteUsers(@Param("ids") Collection<String> ids);
}
