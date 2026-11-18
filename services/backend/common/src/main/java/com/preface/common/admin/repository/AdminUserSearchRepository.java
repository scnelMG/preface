package com.preface.common.admin.repository;

import com.preface.common.user.entity.User;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * 관리자 회원 목록·검색(S15P31B204-707). 읽기만 한다. 탈퇴 회원도 포함한다.
 *
 * <p>한 페이지의 소셜 제공자·3D 수·마지막 작업 시각은 회원 ID 묶음으로 한 번씩 모아 읽는다(N+1 없음).
 */
public interface AdminUserSearchRepository extends Repository<User, String> {

    /** LIKE 이스케이프 문자. 백슬래시는 MySQL 문자열 이스케이프와 겹쳐 쓰지 않는다. 쿼리의 {@code escape '!'}와 같다. */
    char LIKE_ESCAPE = '!';

    /** userId 일치 1건(탈퇴 회원 포함). */
    Optional<User> findById(String id);

    /** 전체 회원, 가입 최신순. */
    @Query(
            value = "select u from User u order by u.createdAt desc, u.id desc",
            countQuery = "select count(u) from User u")
    Page<User> findAllLatest(Pageable pageable);

    /**
     * 닉네임 부분 일치(대소문자 무시), 가입 최신순. 탈퇴 회원은 닉네임이 비어 걸리지 않는다.
     *
     * @param pattern 소문자로 바꾸고 {@code %}·{@code _}·{@code !}를 {@link #LIKE_ESCAPE}로 이스케이프한 뒤 앞뒤에
     *     {@code %}를 붙인 값
     */
    @Query(
            value =
                    "select u from User u where lower(u.nickname) like :pattern escape '!'"
                            + " order by u.createdAt desc, u.id desc",
            countQuery =
                    "select count(u) from User u where lower(u.nickname) like :pattern escape '!'")
    Page<User> searchByNickname(@Param("pattern") String pattern, Pageable pageable);

    /** 회원별 소셜 제공자. [userId, OAuthProvider] */
    @Query("select s.user.id, s.provider from SocialAccount s where s.user.id in :userIds")
    List<Object[]> findProvidersByUserIds(@Param("userIds") Collection<String> userIds);

    /** 회원별 3D 수(소프트 삭제된 3D 포함). [userId, count] */
    @Query(
            "select m.userId, count(m) from FaceModel m where m.userId in :userIds"
                    + " group by m.userId")
    List<Object[]> countFaceModelsByUserIds(@Param("userIds") Collection<String> userIds);

    /** 회원별 마지막 복원 작업 생성 시각. [userId, Instant] */
    @Query(
            "select j.userId, max(j.createdAt) from ReconstructionJob j where j.userId in :userIds"
                    + " group by j.userId")
    List<Object[]> findLastJobAtByUserIds(@Param("userIds") Collection<String> userIds);
}
