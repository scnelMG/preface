package com.preface.common.facemodel.repository;

import com.preface.common.facemodel.entity.CaptureAngle;
import com.preface.common.facemodel.entity.FaceCaptureImage;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FaceCaptureImageRepository extends JpaRepository<FaceCaptureImage, String> {

    List<FaceCaptureImage> findAllByFaceModelId(String faceModelId);

    /** 3D 결과 화면의 본인 정면 사진(S15P31B204-604). 3D 1개당 방향마다 1장(uk_capture_model_angle). */
    Optional<FaceCaptureImage> findByFaceModelIdAndAngle(String faceModelId, CaptureAngle angle);

    /** 탈퇴·얼굴 동의 철회 때 S3 삭제 대상 조회용. */
    List<FaceCaptureImage> findAllByUserId(String userId);

    /** 탈퇴 때 물리 삭제. 영속성 컨텍스트에 남은 변경을 먼저 반영한다(flush). */
    @Modifying(flushAutomatically = true)
    @Query("delete from FaceCaptureImage x where x.userId = :userId")
    int deleteAllByUserId(@Param("userId") String userId);
}
