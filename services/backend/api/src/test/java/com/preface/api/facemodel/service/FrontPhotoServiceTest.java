package com.preface.api.facemodel.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.reconstruction.service.ReconstructionStorage.PresignedUrl;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.facemodel.entity.CaptureAngle;
import com.preface.common.facemodel.entity.FaceCaptureImage;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceCaptureImageRepository;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * 본인 정면 사진(S15P31B204-604): 본인·삭제 안 된 3D의 FRONT 한 장만 presigned GET(10분)으로 주고, 나머지는 모두 COMMON_002.
 */
class FrontPhotoServiceTest {

    private static final String USER = "u-1";
    private static final String MODEL = "fm-1";
    private static final String KEY = "users/u-1/models/job-1/captures/front.jpg";
    private static final Instant EXPIRES = Instant.parse("2026-11-05T07:10:00Z");

    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final FaceCaptureImageRepository images = mock(FaceCaptureImageRepository.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private FrontPhotoService service;

    @BeforeEach
    void setUp() {
        service = new FrontPhotoService(models, images, storage);
        when(storage.presignGet(anyString()))
                .thenAnswer(
                        inv ->
                                new PresignedUrl(
                                        "https://s3.test/" + inv.getArgument(0),
                                        Map.of(),
                                        EXPIRES));
    }

    @Test
    void 내_3D의_정면_사진은_그_사진_key의_presigned_URL과_만료를_준다() {
        when(models.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.of(mock(FaceModel.class)));
        when(images.findByFaceModelIdAndAngle(MODEL, CaptureAngle.FRONT))
                .thenReturn(Optional.of(FaceCaptureImage.of(MODEL, USER, CaptureAngle.FRONT, KEY)));

        var response = service.frontPhoto(USER, MODEL);

        assertThat(response.url()).isEqualTo("https://s3.test/" + KEY);
        assertThat(response.expiresAt()).isEqualTo(EXPIRES);
    }

    @Test
    void 남의_3D나_삭제된_3D는_사진을_찾지도_않고_COMMON_002다() {
        when(models.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER)).thenReturn(Optional.empty());

        assertNotFound();
        verify(images, never()).findByFaceModelIdAndAngle(anyString(), any());
        verify(storage, never()).presignGet(anyString());
    }

    @Test
    void 사진을_보관하기_전에_만든_예전_3D는_COMMON_002다() {
        when(models.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.of(mock(FaceModel.class)));
        when(images.findByFaceModelIdAndAngle(MODEL, CaptureAngle.FRONT))
                .thenReturn(Optional.empty());

        assertNotFound();
        verify(storage, never()).presignGet(anyString());
    }

    @Test
    void 응답의_toString은_URL을_가린다() {
        when(models.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.of(mock(FaceModel.class)));
        when(images.findByFaceModelIdAndAngle(MODEL, CaptureAngle.FRONT))
                .thenReturn(Optional.of(FaceCaptureImage.of(MODEL, USER, CaptureAngle.FRONT, KEY)));

        assertThat(service.frontPhoto(USER, MODEL).toString()).doesNotContain("s3.test");
    }

    private void assertNotFound() {
        assertThatThrownBy(() -> service.frontPhoto(USER, MODEL))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(CommonErrorCode.NOT_FOUND);
    }
}
