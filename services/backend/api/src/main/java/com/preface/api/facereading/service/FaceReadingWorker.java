package com.preface.api.facereading.service;

import com.preface.common.facereading.repository.FaceReadingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 관상 1건을 만든다: 묶음에서 정면 프레임 → 엔진(GMS) → 결과 저장. 요청 트랜잭션이 커밋된 뒤 전용 풀에서 돈다.
 *
 * <p>사진은 이 메서드 안에서만 쓰고 저장·로그하지 않는다. 어떤 실패든 FAILED로 남기고 3D 생성에는 영향을 주지 않는다.
 */
@Component
class FaceReadingWorker {

    private static final Logger log = LoggerFactory.getLogger(FaceReadingWorker.class);

    private final FaceReadingRepository repository;
    private final FrontFrameSource frames;
    private final FaceReadingEngine engine;
    private final TransactionTemplate tx;
    private final TaskExecutor executor;

    FaceReadingWorker(
            FaceReadingRepository repository,
            FrontFrameSource frames,
            FaceReadingEngine engine,
            TransactionTemplate tx,
            @Qualifier("faceReadingExecutor") TaskExecutor executor) {
        this.repository = repository;
        this.frames = frames;
        this.engine = engine;
        this.tx = tx;
        this.executor = executor;
    }

    /** 풀에 넣는다. 가득 차 있으면 바로 BUSY로 실패시킨다. */
    void submit(String readingId, String framesObjectKey) {
        try {
            executor.execute(() -> run(readingId, framesObjectKey));
        } catch (TaskRejectedException e) {
            finish(readingId, null, FaceReadingFailure.BUSY);
        }
    }

    void run(String readingId, String framesObjectKey) {
        long started = System.nanoTime();
        try {
            byte[] photo = frames.frontJpeg(framesObjectKey);
            FaceReadingEngine.Reading reading = engine.read(photo);
            finish(readingId, reading, null);
            log.info(
                    "face_reading done readingId={} durationMs={}",
                    readingId,
                    (System.nanoTime() - started) / 1_000_000);
        } catch (FaceReadingFailure e) {
            log.info(
                    "face_reading failed readingId={} code={} detail={}",
                    readingId,
                    e.code(),
                    e.getMessage());
            finish(readingId, null, e.code());
        } catch (RuntimeException e) {
            log.warn("face_reading error readingId={}", readingId, e);
            finish(readingId, null, "INTERNAL");
        }
    }

    private void finish(String readingId, FaceReadingEngine.Reading reading, String failCode) {
        tx.executeWithoutResult(
                status ->
                        repository
                                .findById(readingId)
                                .ifPresent(
                                        row -> {
                                            if (reading != null) {
                                                row.complete(reading.resultJson(), reading.model());
                                            } else {
                                                row.fail(failCode);
                                            }
                                        }));
    }
}
