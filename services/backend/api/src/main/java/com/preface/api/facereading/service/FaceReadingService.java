package com.preface.api.facereading.service;

import com.preface.api.facereading.dto.FaceReadingResponse;
import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.repository.FaceUploadRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.FaceReadingErrorCode;
import com.preface.common.facereading.entity.FaceReading;
import com.preface.common.facereading.entity.FaceReadingStatus;
import com.preface.common.facereading.repository.FaceReadingRepository;
import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import java.time.Clock;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

/**
 * AI 관상(재미용, S15P31B204-438) 요청·조회. 3D 생성 작업 1개당 1건만 만들고, 같은 작업으로 다시 요청하면 저장된 것을 준다.
 *
 * <ul>
 *   <li>사진은 프레임 묶음에서만 꺼낸다: 추출이 끝나야({@code frames_ready_at}) 하고, 3D가 성공해 묶음이 지워졌으면 만들 수 없다.
 *   <li>실패(FAILED)나 오래 멈춘 PENDING은 묶음이 아직 있을 때만 같은 행으로 다시 시작한다.
 *   <li>남의 작업·관상은 존재를 숨기고 {@code COMMON_002}.
 *   <li>관상에 쓴 정면 사진은 관상을 요청한 본인에게만, 묶음이 남아 있는 동안만 내려 준다(S15P31B204-452). 저장하지 않는다.
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class FaceReadingService {

    private final ReconstructionJobRepository jobRepository;
    private final FaceUploadRepository uploadRepository;
    private final FaceReadingRepository readingRepository;
    private final FaceReadingWorker worker;
    private final FrontFrameSource frames;
    private final FaceReadingProperties properties;
    private final ObjectMapper mapper;
    private final Clock clock;

    /** 관상을 요청한다. 이미 DONE이거나 진행 중이면 그대로 돌려준다(GMS를 다시 부르지 않는다). */
    @Transactional
    public FaceReadingResponse request(String userId, String jobId) {
        ReconstructionJob job =
                jobRepository
                        .findByIdAndUserId(jobId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        FaceReading existing = readingRepository.findByReconstructionJobId(jobId).orElse(null);
        Instant stalledBefore = Instant.now(clock).minus(properties.stallAfter());
        if (existing != null
                && (existing.getStatus() == FaceReadingStatus.DONE
                        || (existing.getStatus() == FaceReadingStatus.PENDING
                                && !existing.stalledBefore(stalledBefore)))) {
            return toResponse(existing);
        }
        String framesKey = framesKey(job);
        FaceReading reading;
        if (existing == null) {
            reading = readingRepository.saveAndFlush(FaceReading.pending(userId, jobId));
        } else {
            existing.restart();
            reading = readingRepository.saveAndFlush(existing);
        }
        String readingId = reading.getId();
        afterCommit(() -> worker.submit(readingId, framesKey));
        return toResponse(reading);
    }

    @Transactional(readOnly = true)
    public FaceReadingResponse get(String userId, String readingId) {
        return toResponse(
                readingRepository
                        .findByIdAndUserId(readingId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND)));
    }

    /** 그 작업의 관상. 작업이 남의 것이거나 아직 요청한 적이 없으면 {@code COMMON_002}. */
    @Transactional(readOnly = true)
    public FaceReadingResponse getByJob(String userId, String jobId) {
        jobRepository
                .findByIdAndUserId(jobId, userId)
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        return toResponse(
                readingRepository
                        .findByReconstructionJobId(jobId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND)));
    }

    /**
     * 관상에 쓴 정면 사진(줄인 JPEG). 관상을 요청한 작업만 준다. 추출 전 {@code READ_001}, 3D 완성으로 묶음이 지워졌으면 {@code
     * READ_002}, 남의 작업·요청한 적 없음·정면 프레임 없음은 {@code COMMON_002}.
     *
     * <p>S3에서 묶음을 읽는 동안 DB 연결을 잡지 않도록 트랜잭션을 걸지 않는다. 사진은 응답에만 싣고 저장·로그하지 않는다.
     */
    public byte[] photo(String userId, String jobId) {
        ReconstructionJob job =
                jobRepository
                        .findByIdAndUserId(jobId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        if (readingRepository.findByReconstructionJobId(jobId).isEmpty()) {
            throw new BusinessException(CommonErrorCode.NOT_FOUND);
        }
        String framesKey = framesKey(job);
        try {
            return frames.frontJpeg(framesKey);
        } catch (FaceReadingFailure e) {
            if (FaceReadingFailure.PHOTO_GONE.equals(e.code())) {
                throw new BusinessException(FaceReadingErrorCode.PHOTO_GONE);
            }
            throw new BusinessException(CommonErrorCode.NOT_FOUND);
        }
    }

    /** 사진을 꺼낼 묶음 key. 추출 전이면 READ_001, 묶음이 이미 지워졌으면 READ_002. */
    private String framesKey(ReconstructionJob job) {
        if (job.getFramesReadyAt() == null) {
            throw new BusinessException(FaceReadingErrorCode.PHOTO_NOT_READY);
        }
        String key =
                uploadRepository
                        .findById(job.getFaceUploadId())
                        .map(FaceUpload::getFramesObjectKey)
                        .orElse(null);
        if (key == null || key.isBlank()) {
            throw new BusinessException(FaceReadingErrorCode.PHOTO_GONE);
        }
        return key;
    }

    private FaceReadingResponse toResponse(FaceReading reading) {
        return new FaceReadingResponse(
                reading.getId(),
                reading.getReconstructionJobId(),
                reading.getStatus().name(),
                reading.getStatus() == FaceReadingStatus.DONE && reading.getResult() != null
                        ? mapper.readTree(reading.getResult())
                        : null,
                reading.getCreatedAt());
    }

    /** 커밋된 뒤에만 작업을 넣는다(롤백된 요청이 GMS를 부르지 않게, 워커가 아직 안 보이는 행을 찾지 않게). */
    private static void afterCommit(Runnable task) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            task.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        task.run();
                    }
                });
    }
}
