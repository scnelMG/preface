package com.preface.common.facereading.repository;

import com.preface.common.facereading.entity.FaceReading;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FaceReadingRepository extends JpaRepository<FaceReading, String> {

    Optional<FaceReading> findByReconstructionJobId(String reconstructionJobId);

    Optional<FaceReading> findByIdAndUserId(String id, String userId);

    /** 3D 삭제(API-HIS-03) 때 그 3D의 관상을 바로 지운다(결과 글만 있어 S3 정리는 없다). */
    @Modifying(flushAutomatically = true)
    @Query("delete from FaceReading x where x.reconstructionJobId = :jobId")
    int deleteByReconstructionJobId(@Param("jobId") String jobId);
}
