package com.preface.api.facemodel.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.facemodel.dto.FaceModelDetailResponse;
import com.preface.api.facemodel.dto.FaceModelListResponse;
import com.preface.api.hair.service.HairTemplateService;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.reconstruction.service.ReconstructionStorage.PresignedUrl;
import com.preface.common.error.BusinessException;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.facereading.repository.FaceReadingRepository;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;

/** 내 머리 목록·상세·삭제 규칙. DB·S3는 mock. */
class FaceModelServiceTest {

    private static final String USER = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    private static final String MODEL = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
    private static final Instant NOW = Instant.parse("2026-10-23T03:00:00.700Z");
    private static final Instant EXPIRES = Instant.parse("2026-10-23T03:10:00Z");

    private final FaceModelRepository faceModelRepository = mock(FaceModelRepository.class);
    private final SimulationRepository simulationRepository = mock(SimulationRepository.class);
    private final FaceReadingRepository faceReadingRepository = mock(FaceReadingRepository.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private final HairTemplateService hairTemplateService = mock(HairTemplateService.class);
    private FaceModelService service;

    @BeforeEach
    void setUp() {
        service =
                new FaceModelService(
                        faceModelRepository,
                        simulationRepository,
                        faceReadingRepository,
                        storage,
                        Clock.fixed(NOW, ZoneOffset.UTC),
                        hairTemplateService);
        when(storage.presignGet(anyString()))
                .thenAnswer(
                        inv ->
                                new PresignedUrl(
                                        "https://s3.test/" + inv.getArgument(0),
                                        Map.of(),
                                        EXPIRES));
    }

    @Test
    void 삭제하면_3D와_연결_시안이_같은_시각으로_소프트_삭제되고_AI_관상은_바로_지워진다() {
        FaceModel model = model(MODEL, "users/u/models/j/mesh.glb", null, null);
        when(faceModelRepository.findOwnedForUpdate(MODEL, USER)).thenReturn(Optional.of(model));

        assertThat(service.delete(USER, MODEL).deletionStatus()).isEqualTo("PENDING");

        Instant expected = Instant.parse("2026-10-23T03:00:00Z");
        assertThat(model.getDeletedAt()).isEqualTo(expected);
        verify(simulationRepository).softDeleteByFaceModelId(MODEL, expected);
        verify(faceReadingRepository).deleteByReconstructionJobId(model.getReconstructionJobId());
    }

    @Test
    void 없거나_남의_것이거나_이미_지운_3D를_삭제하면_COMMON_002() {
        when(faceModelRepository.findOwnedForUpdate(MODEL, USER)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.delete(USER, MODEL))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode().code()).isEqualTo("COMMON_002"));
        verify(simulationRepository, never()).softDeleteByFaceModelId(anyString(), any());
    }

    @Test
    void 상세는_메시를_presigned_GET으로_주고_텍스처가_없으면_null이다() {
        FaceModel model = model(MODEL, "users/u/models/j/mesh.glb", null, null);
        when(faceModelRepository.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.of(model));

        FaceModelDetailResponse detail = service.detail(USER, MODEL);

        assertThat(detail.meshUrl()).isEqualTo("https://s3.test/users/u/models/j/mesh.glb");
        assertThat(detail.rigUrl()).isNull();
        assertThat(detail.expressionUrl()).isNull();
        assertThat(detail.textureUrl()).isNull();
        assertThat(detail.urlExpiresAt()).isEqualTo(EXPIRES);
        assertThat(detail.meshFormat()).isEqualTo("GLB");
        assertThat(detail.morphSchemaVersion()).isEqualTo("v1");
    }

    @Test
    void 상세는_리그가_있을_때만_서명된_URL을_준다() {
        FaceModel model = model(MODEL, "users/u/models/j/mesh.glb", null, null);
        ReflectionTestUtils.setField(model, "rigObjectKey", "users/u/models/j/rig.json");
        when(faceModelRepository.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.of(model));

        FaceModelDetailResponse detail = service.detail(USER, MODEL);

        assertThat(detail.rigUrl()).isEqualTo("https://s3.test/users/u/models/j/rig.json");
        assertThat(detail.toString()).doesNotContain("https://s3.test/");
    }

    @Test
    void 상세에서_없는_3D는_COMMON_002() {
        when(faceModelRepository.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.detail(USER, MODEL))
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode().code()).isEqualTo("COMMON_002"));
    }

    @Test
    void 목록은_시안_개수와_썸네일_URL을_붙이고_size를_50으로_자른다() {
        String other = "4d5e6f70-8b9c-4d0e-9f1a-2b3c4d5e6f70";
        FaceModel withThumb = model(MODEL, "m1.glb", "t1.png", "users/u/models/j/thumbnail.png");
        FaceModel withoutThumb = model(other, "m2.glb", null, null);
        when(faceModelRepository.findByUserIdAndDeletedAtIsNull(any(), any()))
                .thenAnswer(
                        inv ->
                                new PageImpl<>(
                                        List.of(withThumb, withoutThumb),
                                        (Pageable) inv.getArgument(1),
                                        2));
        when(simulationRepository.countVisibleByFaceModelIds(List.of(MODEL, other)))
                .thenReturn(List.<Object[]>of(new Object[] {MODEL, 3L}));

        FaceModelListResponse list = service.list(USER, -1, 500);

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(faceModelRepository).findByUserIdAndDeletedAtIsNull(any(), pageable.capture());
        assertThat(pageable.getValue().getPageNumber()).isZero();
        assertThat(pageable.getValue().getPageSize()).isEqualTo(50);
        assertThat(list.page()).isZero();
        assertThat(list.size()).isEqualTo(50);
        assertThat(list.totalElements()).isEqualTo(2);
        assertThat(list.items().get(0).simulationCount()).isEqualTo(3);
        assertThat(list.items().get(0).thumbnailUrl())
                .isEqualTo("https://s3.test/users/u/models/j/thumbnail.png");
        assertThat(list.items().get(1).simulationCount()).isZero();
        assertThat(list.items().get(1).thumbnailUrl()).isNull();
    }

    @Test
    void 상세는_표정_리그가_있으면_메시와_같은_만료로_서명하고_toString에서_가린다() {
        FaceModel model = model(MODEL, "users/u/models/j/a1/mesh.glb", null, null);
        model.attachExpressionRig("users/u/models/j/a1/expression.json");
        when(faceModelRepository.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.of(model));

        FaceModelDetailResponse detail = service.detail(USER, MODEL);

        assertThat(detail.expressionUrl())
                .isEqualTo("https://s3.test/users/u/models/j/a1/expression.json");
        assertThat(detail.urlExpiresAt()).isEqualTo(EXPIRES);
        assertThat(detail.toString())
                .contains("expressionUrl=<redacted>")
                .doesNotContain("https://");
    }

    @Test
    void 메시가_다른_폴더로_바뀐_모델은_옛_표정_리그_주소를_주지_않는다() {
        FaceModel model = model(MODEL, "users/u/models/m/a1/head.glb", null, null);
        model.attachExpressionRig("users/u/models/j/expression.json");
        when(faceModelRepository.findByIdAndUserIdAndDeletedAtIsNull(MODEL, USER))
                .thenReturn(Optional.of(model));

        assertThat(service.detail(USER, MODEL).expressionUrl()).isNull();
        verify(storage, never()).presignGet("users/u/models/j/expression.json");
        assertThat(model.getExpressionObjectKey()).isEqualTo("users/u/models/j/expression.json");
    }

    @Test
    void 목록이_비면_시안_개수를_조회하지_않는다() {
        when(faceModelRepository.findByUserIdAndDeletedAtIsNull(any(), any()))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 20), 0));

        assertThat(service.list(USER, 0, 20).items()).isEmpty();
        verify(simulationRepository, never()).countVisibleByFaceModelIds(any());
    }

    private static FaceModel model(String id, String mesh, String texture, String thumbnail) {
        FaceModel model =
                FaceModel.create(
                        USER, "job-" + id, mesh, null, null, texture, thumbnail, "GLB", "v1", null);
        ReflectionTestUtils.setField(model, "id", id);
        return model;
    }
}
