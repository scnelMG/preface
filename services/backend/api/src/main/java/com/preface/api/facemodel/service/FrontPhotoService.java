package com.preface.api.facemodel.service;

import com.preface.api.facemodel.dto.FrontPhotoResponse;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.facemodel.entity.CaptureAngle;
import com.preface.common.facemodel.repository.FaceCaptureImageRepository;
import com.preface.common.facemodel.repository.FaceModelRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 3D 결과 화면에 실제 얼굴과 비교해 보여 줄 본인 정면 사진(S15P31B204-604). 3D 완성 때 보관한 5방향 사진({@code
 * face_capture_image}) 중 FRONT 한 장의 presigned GET(10분)을 준다. 사진은 Spring이 중계하지 않는다.
 *
 * <p>남의 3D·삭제된 3D·사진을 보관하기 전에 만든 3D는 모두 {@code COMMON_002}다(있는지 숨긴다).
 */
@Service
@RequiredArgsConstructor
public class FrontPhotoService {

    private final FaceModelRepository faceModelRepository;
    private final FaceCaptureImageRepository faceCaptureImageRepository;
    private final ReconstructionStorage storage;

    @Transactional(readOnly = true)
    public FrontPhotoResponse frontPhoto(String userId, String faceModelId) {
        faceModelRepository
                .findByIdAndUserIdAndDeletedAtIsNull(faceModelId, userId)
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        var image =
                faceCaptureImageRepository
                        .findByFaceModelIdAndAngle(faceModelId, CaptureAngle.FRONT)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        var url = storage.presignGet(image.getObjectKey());
        return new FrontPhotoResponse(url.url(), url.expiresAt());
    }
}
