package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

class ExistingEyeApprovalServiceTest {
    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final EyeEditService approval = mock(EyeEditService.class);
    private final ExistingEyeApprovalService service =
            new ExistingEyeApprovalService(
                    models,
                    approval,
                    new TransactionTemplate(mock(PlatformTransactionManager.class)),
                    JsonMapper.builder().build());
    private final EyeApprovalRequest request =
            new EyeApprovalRequest(
                    "v1",
                    new EyeApprovalRequest.Binding(
                            "mesh-sha", "rig-sha", "parts", "engine", "1", "1"),
                    Map.of("inner", 20.0));
    private final FaceModel original = model("mesh");

    @BeforeEach
    void setup() {
        when(models.findById("model")).thenReturn(Optional.of(original));
        when(approval.verifyAssets(eq("mesh"), eq("rig"), any(), eq(request))).thenReturn(true);
    }

    @Test
    void 같은_자산의_누락된_눈_승인을_복구한다() {
        when(models.findOwnedForUpdate("model", "owner")).thenReturn(Optional.of(original));
        when(approval.approveWithVerifiedAssets("model", request)).thenReturn(true);

        service.restore("model", request);

        verify(approval).approveWithVerifiedAssets("model", request);
    }

    @Test
    void 검사_중_원본이_바뀌면_후보를_반영하지_않는다() {
        when(models.findOwnedForUpdate("model", "owner")).thenReturn(Optional.of(model("changed")));

        assertThatThrownBy(() -> service.restore("model", request))
                .isInstanceOf(BusinessException.class);
        verify(approval, never()).approveWithVerifiedAssets(any(), any());
    }

    private static FaceModel model(String mesh) {
        FaceModel model =
                FaceModel.create("owner", "job", mesh, "rig", null, null, null, "GLB", "v1", null);
        model.recordEyeReview("{\"L\":\"present\",\"R\":\"absent\"}", "parts");
        return model;
    }
}
