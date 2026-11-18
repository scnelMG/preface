package com.preface.api.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.admin.service.AdminStorage.Listing;
import com.preface.api.admin.service.AdminStorage.SignedUrl;
import com.preface.api.admin.service.AdminStorage.StoredObject;
import com.preface.common.admin.entity.AdminAccessTargetType;
import com.preface.common.admin.repository.AdminUserDataRepository;
import com.preface.common.admin.repository.AdminUserDataRepository.FaceModelRow;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.facemodel.entity.CaptureAngle;
import com.preface.common.facemodel.entity.FaceCaptureImage;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceCaptureImageRepository;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.reconstruction.entity.ReconstructionStatus;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

/** 관리자 회원별 3D·S3 조회 규칙(S15P31B204-653). DB·S3는 mock, 값은 합성. */
class AdminUserDataServiceTest {

    private static final String ADMIN = "00000000-0000-0000-0000-00000000000a";
    private static final String USER = "00000000-0000-0000-0000-000000000001";
    private static final String MODEL = "model-1";
    private static final Instant NOW = Instant.parse("2026-11-07T00:00:00Z");
    private static final String SIGNED = "https://s3.example.test/obj?X-Amz-Signature=fake";

    private final AdminUserDataRepository adminRepository = mock(AdminUserDataRepository.class);
    private final FaceModelRepository faceModelRepository = mock(FaceModelRepository.class);
    private final FaceCaptureImageRepository captureRepository =
            mock(FaceCaptureImageRepository.class);
    private final AdminStorage storage = mock(AdminStorage.class);
    private final AdminAccessLogger accessLogger = mock(AdminAccessLogger.class);

    private AdminUserDataService service(String environment) {
        return new AdminUserDataService(
                adminRepository,
                faceModelRepository,
                captureRepository,
                storage,
                accessLogger,
                new AdminProperties(environment),
                Clock.fixed(NOW, ZoneOffset.UTC),
                Duration.ofDays(30));
    }

    @Test
    void 개발에서는_촬영_사진을_주고_조회_기록을_두_건_남긴다() {
        givenModel();
        var response =
                service("dev").assets(ADMIN, MODEL, "/api/v1/admin/face-models/model-1/assets");

        assertThat(response.captureImages()).extracting("angle").containsExactly("FRONT", "LEFT");
        assertThat(response.texturedMeshUrl()).isEqualTo(SIGNED);
        assertThat(response.baseMeshUrl()).isNull();
        assertThat(response.thumbnailUrl()).isNull();
        verify(accessLogger)
                .record(
                        ADMIN,
                        USER,
                        AdminAccessTargetType.FACE_MODEL,
                        MODEL,
                        "/api/v1/admin/face-models/model-1/assets");
        verify(accessLogger)
                .record(
                        ADMIN,
                        USER,
                        AdminAccessTargetType.CAPTURE_IMAGE,
                        MODEL,
                        "/api/v1/admin/face-models/model-1/assets");
    }

    @Test
    void 운영에서는_촬영_사진을_빈_배열로_주고_사진_조회_기록을_남기지_않는다() {
        givenModel();
        var response = service("prod").assets(ADMIN, MODEL, "/p");

        assertThat(response.captureImages()).isEmpty();
        verify(captureRepository, never()).findAllByFaceModelId(anyString());
        verify(storage, times(1)).presignGet(anyString()); // 메시만 서명
        verify(accessLogger, never())
                .record(any(), any(), eq(AdminAccessTargetType.CAPTURE_IMAGE), any(), any());
    }

    @Test
    void 서명_URL은_조회_기록과_toString에_들어가지_않는다() {
        givenModel();
        var response = service("dev").assets(ADMIN, MODEL, "/p");

        ArgumentCaptor<String> args = ArgumentCaptor.forClass(String.class);
        verify(accessLogger, times(2))
                .record(args.capture(), args.capture(), any(), args.capture(), args.capture());
        assertThat(args.getAllValues()).noneMatch(v -> v != null && v.contains("X-Amz"));
        assertThat(response.toString()).doesNotContain("X-Amz").doesNotContain("https://");
        assertThat(response.captureImages().getFirst().toString()).doesNotContain("https://");
    }

    @Test
    void 없는_3D는_COMMON_002이고_기록을_남기지_않는다() {
        when(faceModelRepository.findById("nope")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service("dev").assets(ADMIN, "nope", "/p"))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(CommonErrorCode.NOT_FOUND);
        verify(accessLogger, never()).record(any(), any(), any(), any(), any());
    }

    @Test
    void 목록은_시안_수를_묶음_조회_한_번으로_붙이고_삭제_예정_시각을_계산한다() {
        Instant deletedAt = NOW.minus(Duration.ofDays(1));
        FaceModelRow live = row("m-1", null);
        FaceModelRow deleted = row("m-2", deletedAt);
        when(adminRepository.findFaceModelsByUserId(eq(USER), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(live, deleted), PageRequest.of(0, 20), 2));
        when(adminRepository.countSimulationsByFaceModelIds(List.of("m-1", "m-2")))
                .thenReturn(List.<Object[]>of(new Object[] {"m-1", 3L}));

        var response = service("dev").faceModels(ADMIN, USER, null, 500, "/p");

        assertThat(response.size()).isEqualTo(100);
        assertThat(response.totalElements()).isEqualTo(2);
        assertThat(response.items().get(0).simulationCount()).isEqualTo(3);
        assertThat(response.items().get(0).deleteScheduledAt()).isNull();
        assertThat(response.items().get(1).simulationCount()).isZero();
        assertThat(response.items().get(1).deleteScheduledAt())
                .isEqualTo(deletedAt.plus(Duration.ofDays(30)));
        assertThat(response.items().get(0).jobStatus()).isEqualTo("SUCCEEDED");
        verify(adminRepository, times(1)).countSimulationsByFaceModelIds(any());
        verify(accessLogger).record(ADMIN, USER, AdminAccessTargetType.FACE_MODEL, null, "/p");
    }

    @Test
    void userId가_UUID가_아니면_S3를_나열하지_않는다() {
        assertThatThrownBy(() -> service("dev").storage(ADMIN, "../x", "/p"))
                .isInstanceOf(BusinessException.class);
        verify(storage, never()).list(anyString(), anyInt());
    }

    @Test
    void 저장_목록은_회원_prefix만_나열하고_FAILED_기록을_삭제_실패로_준다() {
        String prefix = "users/" + USER + "/";
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn(MODEL);
        when(model.getMeshObjectKey()).thenReturn(prefix + "models/j/a1/mesh.glb");
        when(faceModelRepository.findAllByUserId(USER)).thenReturn(List.of(model));
        DataDeletionLog failed = mock(DataDeletionLog.class);
        when(failed.getStatus()).thenReturn("FAILED");
        when(failed.getObjectKey()).thenReturn(prefix + "models/j/a1/texture.png");
        when(failed.getReason()).thenReturn("SOFT_DELETE_EXPIRED");
        when(failed.getRetryCount()).thenReturn(5);
        when(failed.getCreatedAt()).thenReturn(NOW);
        when(adminRepository.findDeletionLogs(eq(USER), any())).thenReturn(List.of(failed));
        when(storage.list(prefix, AdminUserDataService.MAX_STORAGE_OBJECTS))
                .thenReturn(
                        new Listing(
                                List.of(
                                        new StoredObject(prefix + "models/j/a1/mesh.glb", 5, NOW),
                                        new StoredObject(
                                                prefix + "models/j/a1/texture.png", 6, NOW)),
                                false));

        var response = service("dev").storage(ADMIN, USER, "/p");

        assertThat(response.prefix()).isEqualTo(prefix);
        assertThat(response.checkedAt()).isEqualTo(NOW);
        assertThat(response.objects()).extracting("state").containsExactly("OK", "DELETE_FAILED");
        assertThat(response.deletionFailures())
                .singleElement()
                .satisfies(
                        f -> {
                            assertThat(f.reason()).isEqualTo("SOFT_DELETE_EXPIRED");
                            assertThat(f.retryCount()).isEqualTo(5);
                        });
        verify(accessLogger).record(ADMIN, USER, AdminAccessTargetType.STORAGE, null, "/p");
    }

    @Test
    void 저장_목록은_표정_리그도_3D_key로_대조한다() {
        String prefix = "users/" + USER + "/";
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn(MODEL);
        when(model.getMeshObjectKey()).thenReturn(prefix + "models/j/a1/mesh.glb");
        when(model.getExpressionObjectKey()).thenReturn(prefix + "models/j/a1/expression.json");
        when(faceModelRepository.findAllByUserId(USER)).thenReturn(List.of(model));
        when(storage.list(prefix, AdminUserDataService.MAX_STORAGE_OBJECTS))
                .thenReturn(
                        new Listing(
                                List.of(
                                        new StoredObject(
                                                prefix + "models/j/a1/expression.json", 4, NOW),
                                        new StoredObject(prefix + "models/j/a1/mesh.glb", 5, NOW)),
                                false));

        var response = service("dev").storage(ADMIN, USER, "/p");

        assertThat(response.objects())
                .extracting("source", "state")
                .containsOnly(tuple("FACE_MODEL", "OK"));
    }

    private void givenModel() {
        FaceModel model = mock(FaceModel.class);
        when(model.getId()).thenReturn(MODEL);
        when(model.getUserId()).thenReturn(USER);
        when(model.getMeshObjectKey()).thenReturn("users/u/models/j/a1/mesh.glb");
        when(faceModelRepository.findById(MODEL)).thenReturn(Optional.of(model));
        List<FaceCaptureImage> images =
                List.of(
                        capture(CaptureAngle.LEFT, "users/u/models/j/a1/left.jpg"),
                        capture(CaptureAngle.FRONT, "users/u/models/j/a1/front.jpg"));
        when(captureRepository.findAllByFaceModelId(MODEL)).thenReturn(images);
        when(storage.presignGet(anyString()))
                .thenReturn(new SignedUrl(SIGNED, NOW.plus(Duration.ofMinutes(5))));
    }

    private static FaceCaptureImage capture(CaptureAngle angle, String key) {
        FaceCaptureImage image = mock(FaceCaptureImage.class);
        when(image.getAngle()).thenReturn(angle);
        when(image.getObjectKey()).thenReturn(key);
        return image;
    }

    private static FaceModelRow row(String id, Instant deletedAt) {
        FaceModelRow row = mock(FaceModelRow.class);
        when(row.getFaceModelId()).thenReturn(id);
        when(row.getJobId()).thenReturn("job-" + id);
        when(row.getCreatedAt()).thenReturn(NOW);
        when(row.getVideoDurationMs()).thenReturn(12000);
        when(row.getJobStatus()).thenReturn(ReconstructionStatus.SUCCEEDED);
        when(row.getDeletedAt()).thenReturn(deletedAt);
        return row;
    }
}
