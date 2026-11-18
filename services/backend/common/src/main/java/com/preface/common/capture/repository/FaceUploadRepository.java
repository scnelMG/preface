package com.preface.common.capture.repository;

import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.entity.FaceUploadStatus;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FaceUploadRepository extends JpaRepository<FaceUpload, String> {

    /** 탈퇴·얼굴 동의 철회 때 S3 삭제 대상(원본이 아직 남아 있을 수 있는 업로드). */
    List<FaceUpload> findAllByUserIdAndStatusNot(String userId, FaceUploadStatus status);

    /** 탈퇴·얼굴 동의 철회 때 프레임 묶음 삭제 대상. */
    List<FaceUpload> findAllByUserIdAndFramesObjectKeyNotNull(String userId);

    /** 탈퇴 때 물리 삭제. 영속성 컨텍스트에 남은 변경을 먼저 반영한다(flush). */
    @Modifying(flushAutomatically = true)
    @Query("delete from FaceUpload x where x.userId = :userId")
    int deleteAllByUserId(@Param("userId") String userId);
}
