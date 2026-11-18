package com.preface.api.facemodel.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.api.facemodel.dto.ExpressionRigRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** 기존 모델 표정 트래킹 리그 보충(S15P31B204-879). DB는 mock. */
class ExistingExpressionRigServiceTest {

    private static final String MODEL = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
    private static final String FOLDER = "users/u-1/models/job-1/a1/";

    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final ExistingExpressionRigService service = new ExistingExpressionRigService(models);
    private final FaceModel model =
            FaceModel.create(
                    "u-1",
                    "job-1",
                    FOLDER + "mesh.glb",
                    FOLDER + "rig.json",
                    null,
                    null,
                    null,
                    "GLB",
                    "v1",
                    null);

    @Test
    void 메시와_같은_폴더의_표정_리그를_저장하고_같은_key로_다시_불러도_성공한다() {
        model.approveNose("{\"schemaVersion\":\"v1\"}");
        when(models.findByIdAndDeletedAtIsNull(MODEL)).thenReturn(Optional.of(model));

        service.attach(MODEL, new ExpressionRigRequest(FOLDER + "expression.json"));
        service.attach(MODEL, new ExpressionRigRequest(FOLDER + "expression.json"));

        assertThat(model.getExpressionObjectKey()).isEqualTo(FOLDER + "expression.json");
        assertThat(model.getRigObjectKey()).isEqualTo(FOLDER + "rig.json");
        assertThat(model.getApprovedNoseCapabilities()).isEqualTo("{\"schemaVersion\":\"v1\"}");
        assertThat(model.isChatApplyReady()).isTrue();
    }

    @Test
    void 다른_폴더나_다른_파일을_가리키면_COMMON_001이고_저장하지_않는다() {
        when(models.findByIdAndDeletedAtIsNull(MODEL)).thenReturn(Optional.of(model));

        for (String key :
                new String[] {
                    "users/u-1/models/job-1/a2/expression.json",
                    "users/u-2/models/job-1/a1/expression.json",
                    FOLDER + "rig.json",
                    FOLDER + "sub/expression.json"
                }) {
            assertCode(() -> service.attach(MODEL, new ExpressionRigRequest(key)), "COMMON_001");
        }
        assertThat(model.getExpressionObjectKey()).isNull();
    }

    @Test
    void 없거나_지운_모델은_COMMON_002() {
        when(models.findByIdAndDeletedAtIsNull(MODEL)).thenReturn(Optional.empty());

        assertCode(
                () -> service.attach(MODEL, new ExpressionRigRequest(FOLDER + "expression.json")),
                "COMMON_002");
    }

    private static void assertCode(Runnable call, String code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode().code()).isEqualTo(code));
    }
}
