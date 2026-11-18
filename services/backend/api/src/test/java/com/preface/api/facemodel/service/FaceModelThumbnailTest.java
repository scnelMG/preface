package com.preface.api.facemodel.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.facemodel.dto.ThumbnailSaveRequest;
import com.preface.api.facemodel.dto.ThumbnailUploadRequest;
import com.preface.api.hair.service.HairTemplateService;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.reconstruction.service.ReconstructionStorage.PresignedUrl;
import com.preface.api.reconstruction.service.ReconstructionStorage.UploadCheck;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.HistoryErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.facereading.repository.FaceReadingRepository;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** 내 머리 썸네일 올리기(S15P31B204-436): 본인·썸네일 없을 때만 URL, 올라온 것을 확인한 뒤 비어 있을 때만 저장. */
class FaceModelThumbnailTest {

    private static final String USER = "u-1";
    private static final String MODEL = "fm-1";
    private static final String KEY = "users/u-1/models/job-1/thumbnail-web.webp";
    private static final Instant EXPIRES = Instant.parse("2026-10-29T06:10:00Z");

    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private FaceModelService service;

    @BeforeEach
    void setUp() {
        service =
                new FaceModelService(
                        models,
                        mock(SimulationRepository.class),
                        mock(FaceReadingRepository.class),
                        storage,
                        Clock.fixed(EXPIRES, ZoneOffset.UTC),
                        mock(HairTemplateService.class));
        when(storage.presignPut(anyString(), anyString(), anyLong(), anyString()))
                .thenAnswer(
                        inv ->
                                new PresignedUrl(
                                        "https://s3.test/put/" + inv.getArgument(0),
                                        Map.of("x-amz-server-side-encryption", "AES256"),
                                        EXPIRES));
        when(storage.presignGet(anyString()))
                .thenAnswer(
                        inv ->
                                new PresignedUrl(
                                        "https://s3.test/" + inv.getArgument(0),
                                        Map.of(),
                                        EXPIRES));
    }

    @Test
    void 썸네일이_없는_내_머리는_모델_폴더의_고정_key로_크기_체크섬이_서명된_PUT_URL을_받는다() {
        when(models.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.of(model(null)));

        var response =
                service.thumbnailUploadUrl(USER, MODEL, new ThumbnailUploadRequest(9000, "c2hh"));

        assertThat(response.objectKey()).isEqualTo(KEY);
        assertThat(response.headers()).containsKey("x-amz-server-side-encryption");
        verify(storage).presignPut(KEY, "image/webp", 9000, "c2hh");
    }

    @Test
    void 이미_썸네일이_있으면_HIS_010이고_남의_것이면_COMMON_002다() {
        when(models.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.of(model("users/u-1/models/job-1/a1/thumbnail.webp")));
        assertCode(
                () ->
                        service.thumbnailUploadUrl(
                                USER, MODEL, new ThumbnailUploadRequest(1, "c2hh")),
                HistoryErrorCode.THUMBNAIL_EXISTS);

        assertCode(
                () ->
                        service.thumbnailUploadUrl(
                                "other", MODEL, new ThumbnailUploadRequest(1, "c2hh")),
                CommonErrorCode.NOT_FOUND);
    }

    @Test
    void 올라온_것을_확인한_뒤_비어_있을_때만_저장하고_주소를_돌려준다() {
        FaceModel model = model(null);
        when(models.findOwnedForUpdate(MODEL, USER)).thenReturn(Optional.of(model));
        when(storage.checkUpload(KEY, 9000, "c2hh")).thenReturn(UploadCheck.PRESENT);

        var saved = service.saveThumbnail(USER, MODEL, new ThumbnailSaveRequest(KEY, 9000, "c2hh"));

        assertThat(model.getThumbnailObjectKey()).isEqualTo(KEY);
        assertThat(saved.thumbnailUrl()).isEqualTo("https://s3.test/" + KEY);
    }

    @Test
    void 이미_다른_썸네일이_먼저_저장됐으면_바꾸지_않고_그_주소를_준다() {
        String first = "users/u-1/models/job-1/a1/thumbnail.webp";
        when(models.findOwnedForUpdate(MODEL, USER)).thenReturn(Optional.of(model(first)));

        var saved = service.saveThumbnail(USER, MODEL, new ThumbnailSaveRequest(KEY, 9000, "c2hh"));

        assertThat(saved.thumbnailUrl()).isEqualTo("https://s3.test/" + first);
        verify(storage, never()).checkUpload(anyString(), anyLong(), anyString());
    }

    @Test
    void 다른_key이거나_S3에_없으면_HIS_011이고_저장하지_않는다() {
        FaceModel model = model(null);
        when(models.findOwnedForUpdate(MODEL, USER)).thenReturn(Optional.of(model));
        assertCode(
                () ->
                        service.saveThumbnail(
                                USER,
                                MODEL,
                                new ThumbnailSaveRequest(
                                        "users/u-2/models/x/thumbnail-web.webp", 9000, "c2hh")),
                HistoryErrorCode.THUMBNAIL_NOT_UPLOADED);

        when(storage.checkUpload(KEY, 9000, "c2hh")).thenReturn(UploadCheck.MISSING);
        assertCode(
                () ->
                        service.saveThumbnail(
                                USER, MODEL, new ThumbnailSaveRequest(KEY, 9000, "c2hh")),
                HistoryErrorCode.THUMBNAIL_NOT_UPLOADED);
        assertThat(model.getThumbnailObjectKey()).isNull();
    }

    private static void assertCode(Runnable call, Object code) {
        assertThatThrownBy(call::run)
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(code);
    }

    private static FaceModel model(String thumbnail) {
        FaceModel model =
                FaceModel.create(
                        USER,
                        "job-1",
                        "users/u-1/models/job-1/a1/mesh.glb",
                        null,
                        null,
                        null,
                        thumbnail,
                        "GLB",
                        "v1",
                        null);
        ReflectionTestUtils.setField(model, "id", MODEL);
        return model;
    }
}
