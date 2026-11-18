package com.preface.api.reconstruction.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

class EditApprovalRetryServiceTest {
    @Test
    void 검사기가_두_번_실패한_뒤에도_저장한_후보로_같은_모델을_승인한다() {
        var models = mock(FaceModelRepository.class);
        var noseApproval = mock(NoseModelApproval.class);
        var eyeApproval = mock(EyeModelApproval.class);
        var clock = mock(Clock.class);
        var json = JsonMapper.builder().build();
        var service =
                new EditApprovalRetryService(
                        models,
                        noseApproval,
                        eyeApproval,
                        new TransactionTemplate(mock(PlatformTransactionManager.class)),
                        clock,
                        json);
        FaceModel model =
                FaceModel.create(
                        "owner", "job", "mesh", "rig", null, null, null, "GLB", "v1", null);
        model.recordEyeReview("{\"L\":\"present\",\"R\":\"absent\"}", "parts");
        var nose = new NoseApprovalRequest("v1", null, Map.of());
        var eye = new EyeApprovalRequest("v1", null, Map.of());
        Instant start = Instant.parse("2026-11-09T07:00:00Z");
        model.scheduleEditApprovalRetry(
                json.writeValueAsString(
                        new EditApprovalRetryService.Candidate(
                                "mesh",
                                "rig",
                                "parts",
                                "{\"R\":\"absent\",\"L\":\"present\"}",
                                nose,
                                eye,
                                0)),
                start);
        when(models.findDueEditApprovalRetries(any(), any())).thenReturn(List.of("model"));
        when(models.findByIdAndDeletedAtIsNull("model")).thenReturn(Optional.of(model));
        var unavailable = new BusinessException(ReconstructionErrorCode.RESULT_CHECK_UNAVAILABLE);
        when(noseApproval.validateForGeneration("mesh", "rig", nose))
                .thenThrow(unavailable)
                .thenThrow(unavailable)
                .thenReturn("{\"approved\":true}");
        when(eyeApproval.verifyAssets(eq("mesh"), eq("rig"), any(), eq(eye)))
                .thenThrow(unavailable)
                .thenThrow(unavailable)
                .thenReturn(true);
        when(eyeApproval.approveWithVerifiedAssets(null, eye))
                .thenAnswer(
                        invocation -> {
                            model.approveEyes("{\"approved\":true}");
                            return true;
                        });
        when(clock.instant()).thenReturn(start);
        service.retryDue();
        assertThat(model.getApprovedNoseCapabilities()).isNull();
        assertThat(model.getEditApprovalRetryAt()).isAfter(start);
        when(clock.instant()).thenReturn(model.getEditApprovalRetryAt());
        service.retryDue();
        assertThat(model.getApprovedEyeCapabilities()).isNull();
        when(clock.instant()).thenReturn(model.getEditApprovalRetryAt());
        service.retryDue();
        assertThat(model.getApprovedNoseCapabilities()).isNotNull();
        assertThat(model.getApprovedEyeCapabilities()).isNotNull();
        assertThat(model.getEditApprovalRetryAt()).isNull();
        verify(eyeApproval).approveWithVerifiedAssets(null, eye);
    }
}
