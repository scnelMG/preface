package com.preface.common.reconstruction.repository;

import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReconstructionJobRepository extends JpaRepository<ReconstructionJob, String> {

    Optional<ReconstructionJob> findByFaceUploadId(String faceUploadId);

    Optional<ReconstructionJob> findByIdAndUserId(String id, String userId);

    List<ReconstructionJob> findAllByUserIdAndStatusIn(
            String userId, Collection<ReconstructionStatus> statuses);

    boolean existsByUserIdAndStatusIn(String userId, Collection<ReconstructionStatus> statuses);

    Optional<ReconstructionJob> findFirstByUserIdAndStatusInOrderByCreatedAtDescIdDesc(
            String userId, Collection<ReconstructionStatus> statuses);

    Optional<ReconstructionJob> findFirstByUserIdOrderByCreatedAtDescIdDesc(String userId);

    /** 워커 보고·회수가 같은 작업을 동시에 바꾸지 않게 행 잠금을 건다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select j from ReconstructionJob j where j.id = :id")
    Optional<ReconstructionJob> findByIdForUpdate(@Param("id") String id);

    /**
     * 추출 대기 작업 하나를 잠그고 ID를 돌려준다(INT-EXT-01). 아무도 안 가져갔거나 lease가 끝난({@code extract_claimed_at <
     * staleBefore}) 작업 중 먼저 들어온 것. 추출 대기열은 Redis가 아니라 이 행들이다 — 작업 수가 적고, lease 회수가 이 조건 하나로 끝난다.
     *
     * <p>SKIP LOCKED: 추출 워커가 여럿이어도 같은 작업을 동시에 잡지 않고 다음 행으로 넘어간다(MySQL 8.0+).
     */
    @Query(
            value =
                    "select id from reconstruction_job"
                            + " where status = 'QUEUED' and frames_ready_at is null"
                            + " and (extract_claimed_at is null or extract_claimed_at < :staleBefore)"
                            + " order by created_at, id limit 1 for update skip locked",
            nativeQuery = true)
    Optional<String> lockNextAwaitingFrames(@Param("staleBefore") Instant staleBefore);

    /**
     * GPU 대기열에서 {@code waitingBefore} 전부터 기다린 작업 ID(S15P31B204-528). 대기 시작은 {@code updated_at}이다 —
     * GPU 대기열에 들어가는 두 경우(프레임 준비, 회수·INTERNAL 재시도로 QUEUED 복귀)가 모두 이 행을 바꾸고, 기다리는 동안에는 행을 바꾸는 일이 없다.
     */
    @Query(
            "select j.id from ReconstructionJob j"
                    + " where j.status = com.preface.common.reconstruction.entity.ReconstructionStatus.QUEUED"
                    + " and j.framesReadyAt is not null and j.updatedAt < :waitingBefore"
                    + " order by j.updatedAt, j.id")
    List<String> findIdsAwaitingGpuSince(@Param("waitingBefore") Instant waitingBefore);

    /**
     * 추출 대기에서 시간 초과로 끝낼 작업 ID(S15P31B204-593). 지금 lease를 잡은 추출 워커가 없는(아무도 안 가져갔거나 마지막 claim의 lease가
     * 끝난, {@code extract_claimed_at < staleBefore}) 작업 중, 시도를 다 썼거나({@code extract_attempts >=
     * maxAttempts}) 마지막 변경({@code updated_at}: 접수 또는 마지막 claim) 뒤 {@code waitingBefore}가 지난 것. 추출
     * 워커가 하나도 없으면 claim이 오지 않아 {@link #lockNextAwaitingFrames}의 회수가 일어나지 않기 때문이다.
     */
    @Query(
            "select j.id from ReconstructionJob j"
                    + " where j.status = com.preface.common.reconstruction.entity.ReconstructionStatus.QUEUED"
                    + " and j.framesReadyAt is null"
                    + " and (j.extractClaimedAt is null or j.extractClaimedAt < :staleBefore)"
                    + " and (j.extractAttempts >= :maxAttempts or j.updatedAt < :waitingBefore)"
                    + " order by j.createdAt, j.id")
    List<String> findIdsExtractionToTimeOut(
            @Param("staleBefore") Instant staleBefore,
            @Param("maxAttempts") int maxAttempts,
            @Param("waitingBefore") Instant waitingBefore);

    /**
     * 추출 대기열 안 순번(1부터, S15P31B204-729). 지금 추출 워커가 가져갈 수 있는 행({@link #lockNextAwaitingFrames}와 같은
     * 조건: 프레임 없음, lease 없음 또는 {@code extract_claimed_at < staleBefore}) 중 이 작업보다 먼저 들어온 수 + 1. 순서도
     * 가져가는 순서와 같은 {@code created_at, id}다. 추출 중(lease가 살아 있는) 작업과 GPU 대기 작업은 세지 않는다.
     *
     * <p>DB에 저장된 값끼리 비교하려고 자기 행을 다시 읽는다(메모리의 시각은 나노초까지 있어 반올림된 DB 값과 다르다). 대기 작업이 적고 {@code
     * idx_recon_extract(status, frames_ready_at, extract_claimed_at)}로 범위를 좁힌다.
     */
    @Query(
            value =
                    "select count(*) from reconstruction_job q join reconstruction_job me"
                            + " on me.id = :id"
                            + " where q.status = 'QUEUED' and q.frames_ready_at is null"
                            + " and (q.extract_claimed_at is null or q.extract_claimed_at < :staleBefore)"
                            + " and (q.created_at < me.created_at"
                            + " or (q.created_at = me.created_at and q.id <= me.id))",
            nativeQuery = true)
    long extractQueuePosition(@Param("id") String id, @Param("staleBefore") Instant staleBefore);

    /**
     * GPU 대기열 안 순번(1부터, S15P31B204-729). 프레임이 준비된 QUEUED 작업 중 이 작업보다 먼저 GPU 대기열에 들어온 수 + 1. 들어온 시각은
     * {@link #findIdsAwaitingGpuSince}와 같은 {@code updated_at}, 같은 시각은 ID로 순서를 정한다.
     */
    @Query(
            value =
                    "select count(*) from reconstruction_job q join reconstruction_job me"
                            + " on me.id = :id"
                            + " where q.status = 'QUEUED' and q.frames_ready_at is not null"
                            + " and (q.updated_at < me.updated_at"
                            + " or (q.updated_at = me.updated_at and q.id <= me.id))",
            nativeQuery = true)
    long gpuQueuePosition(@Param("id") String id);

    /** 지표용 작업 수(S15P31B204-455). 추출 대기는 {@code framesReadyAt}이 비었고, GPU 대기는 채워진 QUEUED다. */
    long countByStatus(ReconstructionStatus status);

    long countByStatusAndFramesReadyAtIsNull(ReconstructionStatus status);

    long countByStatusAndFramesReadyAtIsNotNull(ReconstructionStatus status);

    /** {@code since} 뒤에 끝난 작업의 상태·실패 코드(지표용, S15P31B204-455). 한 시간에 끝나는 작업이 적어 행을 그대로 읽는다. */
    @Query(
            "select j.status as status, j.failCodesJson as failCodesJson"
                    + " from ReconstructionJob j where j.finishedAt >= :since")
    List<FinishedJob> findFinishedSince(@Param("since") Instant since);

    interface FinishedJob {
        ReconstructionStatus getStatus();

        String getFailCodesJson();
    }

    /** 탈퇴 때 물리 삭제. 영속성 컨텍스트에 남은 변경을 먼저 반영한다(flush). */
    @Modifying(flushAutomatically = true)
    @Query("delete from ReconstructionJob x where x.userId = :userId")
    int deleteAllByUserId(@Param("userId") String userId);
}
