package com.preface.common.user.repository;

import com.preface.common.user.entity.OAuthProvider;
import com.preface.common.user.entity.SocialAccount;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SocialAccountRepository extends JpaRepository<SocialAccount, String> {

    @EntityGraph(attributePaths = "user")
    Optional<SocialAccount> findByProviderAndProviderUserId(
            OAuthProvider provider, String providerUserId);

    List<SocialAccount> findAllByUserId(String userId);

    /** 탈퇴 때 물리 삭제. 영속성 컨텍스트에 남은 변경을 먼저 반영한다(flush). */
    @Modifying(flushAutomatically = true)
    @Query("delete from SocialAccount x where x.user.id = :userId")
    int deleteAllByUserId(@Param("userId") String userId);
}
