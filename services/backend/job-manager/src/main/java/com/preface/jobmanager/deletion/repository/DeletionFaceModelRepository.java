package com.preface.jobmanager.deletion.repository;

import com.preface.common.facemodel.entity.FaceCaptureImage;
import com.preface.common.facemodel.entity.FaceModel;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * 3D 물리 삭제(FN-HIS-03). 행을 지우면 시안·5방향 사진({@code face_capture_image})이 FK CASCADE로 함께 지워지므로, S3 key는
 * 지우기 전에 {@link #findCaptureImages}로 모은다.
 */
public interface DeletionFaceModelRepository extends Repository<FaceModel, String> {

    /** 소프트 삭제 뒤 보관 기간이 지난 3D. 인덱스 {@code idx_face_model_deleted}. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from FaceModel m where m.deletedAt < :cutoff order by m.deletedAt, m.id")
    List<FaceModel> lockSoftDeletedBefore(@Param("cutoff") Instant cutoff, Pageable pageable);

    @Query("select c from FaceCaptureImage c where c.faceModelId in :faceModelIds")
    List<FaceCaptureImage> findCaptureImages(
            @Param("faceModelIds") Collection<String> faceModelIds);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from FaceModel m where m.id in :ids")
    int deleteAllByIdIn(@Param("ids") Collection<String> ids);
}
