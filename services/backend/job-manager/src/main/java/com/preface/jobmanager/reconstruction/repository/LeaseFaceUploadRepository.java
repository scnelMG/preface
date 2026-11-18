package com.preface.jobmanager.reconstruction.repository;

import com.preface.common.capture.entity.FaceUpload;
import java.time.Instant;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** lease 만료로 실패시킨 작업의 원본 삭제 예정 시각을 정한다(api 결과 보고의 실패 처리와 같은 규칙). */
public interface LeaseFaceUploadRepository extends Repository<FaceUpload, String> {

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update FaceUpload u set u.retentionExpiresAt = :at where u.id = :id")
    int scheduleRetention(@Param("id") String id, @Param("at") Instant at);
}
