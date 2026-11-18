package com.preface.common.user.repository;

import com.preface.common.user.entity.User;
import com.preface.common.user.entity.UserRole;
import com.preface.common.user.entity.UserStatus;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, String> {

    /** 행 잠금. 탈퇴·동의 철회를 같은 회원의 복원 작업 생성(같은 행을 잠근다)과 한 줄로 세운다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from User u where u.id = :id")
    Optional<User> findByIdForUpdate(@Param("id") String id);

    /** 관리자 API 권한 확인(S15P31B204-651). 엔티티를 불러오지 않고 한 번에 묻는다. */
    boolean existsByIdAndStatusAndRole(String id, UserStatus status, UserRole role);
}
