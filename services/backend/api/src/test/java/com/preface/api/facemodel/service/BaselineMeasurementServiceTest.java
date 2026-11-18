package com.preface.api.facemodel.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.api.facemodel.dto.BaselineMeasurementRequest;
import com.preface.api.facemodel.dto.BaselineMeasurementRequest.Review;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse.Status;
import com.preface.api.reconstruction.dto.NoseApprovalRequest.Binding;
import com.preface.common.error.BusinessException;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class BaselineMeasurementServiceTest {
    private static final Binding BINDING =
            new Binding("a".repeat(64), "b".repeat(64), "fit", "engine", "rig-v1", "topology");
    private final JsonMapper json = JsonMapper.builder().build();
    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final BaselineMeasurementService service = new BaselineMeasurementService(models, json);

    @Test
    void 검수_값을_보존해_조회하고_리그가_바뀌면_보류한다() {
        FaceModel model = model("{\"legacy\":1}");
        when(models.findByIdAndDeletedAtIsNull("model")).thenReturn(Optional.of(model));
        when(models.findByIdAndUserIdAndDeletedAtIsNull("model", "owner"))
                .thenReturn(Optional.of(model));
        assertThat(service.read("owner", "model").status()).isEqualTo(Status.DEFERRED);

        var stored = service.save("model", request(List.of(0.03, 0.04)));

        assertThat(service.read("owner", "model")).isEqualTo(stored);
        assertThat(stored.status()).isEqualTo(Status.AVAILABLE);
        assertThat(json.readTree(model.getMeasurementsJson()).path("legacy").asInt()).isEqualTo(1);
        assertThatThrownBy(() -> service.read("another-user", "model"))
                .isInstanceOf(BusinessException.class);
        approve(
                model,
                new Binding(
                        BINDING.meshSha256(),
                        "c".repeat(64),
                        "fit",
                        "engine",
                        "rig-v2",
                        "topology"));
        assertThat(service.read("owner", "model").status()).isEqualTo(Status.DEFERRED);
    }

    @Test
    void 잘못된_범위를_거절하고_이전_형식은_조회에서_보류한다() {
        FaceModel model = model("[]");
        when(models.findByIdAndDeletedAtIsNull("model")).thenReturn(Optional.of(model));
        when(models.findByIdAndUserIdAndDeletedAtIsNull("model", "owner"))
                .thenReturn(Optional.of(model));

        assertThatThrownBy(() -> service.save("model", request(List.of(0.04, 0.03))))
                .isInstanceOf(BusinessException.class);
        assertThat(model.getMeasurementsJson()).isEqualTo("[]");
        assertThat(service.read("owner", "model").status()).isEqualTo(Status.DEFERRED);
    }

    private FaceModel model(String stored) {
        FaceModel model =
                FaceModel.create(
                        "owner",
                        "job",
                        "head.glb",
                        "rig.json",
                        null,
                        null,
                        null,
                        "GLB",
                        "v2",
                        stored);
        approve(model, BINDING);
        return model;
    }

    private void approve(FaceModel model, Binding binding) {
        model.approveNose(
                json.writeValueAsString(Map.of("schemaVersion", "v2", "binding", binding)));
    }

    private static BaselineMeasurementRequest request(List<Double> alar) {
        return new BaselineMeasurementRequest(
                "v2",
                BINDING,
                new Review(
                        BINDING.meshSha256(),
                        "alar-lateral-frontal-basal-v1",
                        "model-space",
                        "reviewed-pair",
                        Map.of("alarWidth", alar, "intercanthalDistance", List.of(0.02, 0.025))));
    }
}
