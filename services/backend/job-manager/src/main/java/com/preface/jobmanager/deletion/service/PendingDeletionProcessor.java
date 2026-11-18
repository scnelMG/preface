package com.preface.jobmanager.deletion.service;

import static com.preface.jobmanager.deletion.service.DeletionCodes.STATUS_DONE;
import static com.preface.jobmanager.deletion.service.DeletionCodes.STATUS_FAILED;
import static com.preface.jobmanager.deletion.service.DeletionCodes.STATUS_PENDING;
import static com.preface.jobmanager.deletion.service.DeletionCodes.TARGET_FACE_UPLOAD;

import com.preface.common.capture.entity.FaceUploadStatus;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.jobmanager.deletion.repository.DeletionFaceUploadRepository;
import com.preface.jobmanager.deletion.repository.DeletionLogRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@code data_deletion_log}의 PENDING 행을 집어 S3 객체를 지우고 DONE으로 바꾼다. 이 스케줄러가 남긴 행(보관 만료·물리 삭제)과 다른 기능이
 * 남긴 행(복원 성공 즉시 삭제, 탈퇴·얼굴 동의 철회)을 같은 규칙으로 처리한다.
 *
 * <ul>
 *   <li>{@code object_key}가 있으면 S3 DeleteObject. 없으면(기록만 남기는 삭제) 바로 DONE
 *   <li>성공: {@code status=DONE}, {@code completed_at=now}. {@code target_type=FACE_UPLOAD}이면 업로드 행도
 *       DELETED로 바꾼다
 *   <li>실패: {@code retry_count+1}. {@code maxRetries}에 닿으면 FAILED(운영 확인), 아니면 PENDING으로 남아 다음 실행에
 *       재시도
 * </ul>
 *
 * <p>S3 호출은 트랜잭션 밖에서 하고, 행마다 짧은 트랜잭션으로 상태를 바꾼다(느린 S3가 DB 커넥션을 붙잡지 않게). 로그에는 기록 ID·개수만 남긴다 (object
 * key에 회원 ID가 들어 있다).
 */
@Slf4j
@Service
public class PendingDeletionProcessor {

    // 복원 출력 PUT URL은 10분 유효하다. 취소 직후 늦게 도착한 업로드까지 지우도록 여유를 둔다.
    private static final Duration RECON_OUTPUT_DELETE_DELAY = Duration.ofHours(1);

    private final DeletionLogRepository logRepository;
    private final DeletionFaceUploadRepository uploadRepository;
    private final DeletionStorage storage;
    private final DeletionProperties properties;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    public PendingDeletionProcessor(
            DeletionLogRepository logRepository,
            DeletionFaceUploadRepository uploadRepository,
            DeletionStorage storage,
            DeletionProperties properties,
            PlatformTransactionManager transactionManager,
            Clock clock) {
        this.logRepository = logRepository;
        this.uploadRepository = uploadRepository;
        this.storage = storage;
        this.properties = properties;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    public record Result(int done, int retrying, int failed) {

        static final Result EMPTY = new Result(0, 0, 0);

        Result plus(Result other) {
            return new Result(done + other.done, retrying + other.retrying, failed + other.failed);
        }

        int total() {
            return done + retrying + failed;
        }
    }

    /**
     * PENDING 한 배치를 처리한다. {@code skip}에 든 ID(이번 실행에서 이미 시도한 행)는 건너뛴다 — 실패한 행을 같은 실행에서 바로 다시 시도해 재시도
     * 횟수를 한꺼번에 써 버리지 않게.
     */
    public Result processBatch(Set<String> skip) {
        List<DataDeletionLog> rows =
                transactionTemplate.execute(
                        status ->
                                logRepository.findEligible(
                                        STATUS_PENDING,
                                        DataDeletionLog.TARGET_RECON_OUTPUT,
                                        clock.instant().minus(RECON_OUTPUT_DELETE_DELAY),
                                        PageRequest.of(0, properties.batchSize())));
        Result result = Result.EMPTY;
        for (DataDeletionLog row : rows == null ? List.<DataDeletionLog>of() : rows) {
            if (skip.add(row.getId())) {
                result = result.plus(process(row));
            }
        }
        return result;
    }

    private Result process(DataDeletionLog row) {
        String objectKey = row.getObjectKey();
        if (objectKey != null && !objectKey.isBlank()) {
            try {
                storage.delete(objectKey);
            } catch (RuntimeException e) {
                return recordFailure(row, e);
            }
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        transactionTemplate.executeWithoutResult(
                status -> {
                    logRepository.markDone(row.getId(), now, STATUS_DONE, STATUS_PENDING);
                    if (TARGET_FACE_UPLOAD.equals(row.getTargetType())) {
                        uploadRepository.markDeleted(
                                row.getTargetId(), FaceUploadStatus.DELETED, now);
                    }
                });
        return new Result(1, 0, 0);
    }

    private Result recordFailure(DataDeletionLog row, RuntimeException e) {
        int retryCount = row.getRetryCount() + 1;
        boolean giveUp = retryCount >= properties.maxRetries();
        transactionTemplate.executeWithoutResult(
                status ->
                        logRepository.recordFailure(
                                row.getId(),
                                retryCount,
                                giveUp ? STATUS_FAILED : STATUS_PENDING,
                                STATUS_PENDING));
        // 예외 메시지에 key가 들어갈 수 있어 종류만 남긴다
        log.warn(
                "s3 delete failed: logId={}, retryCount={}, gaveUp={}, error={}",
                row.getId(),
                retryCount,
                giveUp,
                e.getClass().getSimpleName());
        return giveUp ? new Result(0, 0, 1) : new Result(0, 1, 0);
    }
}
