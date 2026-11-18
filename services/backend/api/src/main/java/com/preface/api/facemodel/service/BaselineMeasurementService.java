package com.preface.api.facemodel.service;

import com.preface.api.facemodel.dto.BaselineMeasurementRequest;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse.Observation;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse.Status;
import com.preface.api.reconstruction.dto.NoseApprovalRequest.Binding;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

@Service
@RequiredArgsConstructor
public class BaselineMeasurementService {
    private static final String ALAR = "alarWidth";
    private static final String EYES = "intercanthalDistance";
    private static final String DEFINITION = "alar-lateral-frontal-basal-v1";
    private static final String UNIT = "model-space";
    private static final String QUALITY = "reviewed-pair";
    private static final String SOURCE =
            "https://www.facebase.org/resources/human/facial_norms/notes/";

    private final FaceModelRepository models;
    private final ObjectMapper json;

    @Transactional(readOnly = true)
    public BaselineMeasurementResponse read(String userId, String modelId) {
        FaceModel model =
                models.findByIdAndUserIdAndDeletedAtIsNull(modelId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        try {
            var review = measurements(model).get(FaceModel.BASELINE_REVIEW_KEY);
            if (review != null) {
                var stored = json.treeToValue(review, BaselineMeasurementRequest.class);
                if (accepted(model, stored)) {
                    return response(stored.review());
                }
            }
        } catch (JacksonException | IllegalArgumentException e) {
            // 이전 형식이나 손상된 기록은 관찰값을 표시할 근거가 없다.
        }
        return new BaselineMeasurementResponse(Status.DEFERRED, List.of());
    }

    @Transactional
    public BaselineMeasurementResponse save(String modelId, BaselineMeasurementRequest request) {
        FaceModel model =
                models.findByIdAndDeletedAtIsNull(modelId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        try {
            if (!accepted(model, request)) {
                throw invalidReview();
            }
            ObjectNode stored = measurements(model);
            stored.set(FaceModel.BASELINE_REVIEW_KEY, json.valueToTree(request));
            String result = json.writeValueAsString(stored);
            if (result.getBytes(StandardCharsets.UTF_8).length > 64 * 1024) {
                throw invalidReview();
            }
            model.recordMeasurements(result);
            return response(request.review());
        } catch (JacksonException | IllegalArgumentException e) {
            throw invalidReview();
        }
    }

    private boolean accepted(FaceModel model, BaselineMeasurementRequest request) {
        if (request == null
                || request.binding() == null
                || request.review() == null
                || model.getRigObjectKey() == null
                || model.getApprovedNoseCapabilities() == null
                || !"GLB".equals(model.getMeshFormat())
                || !Objects.equals(model.getMorphSchemaVersion(), request.schemaVersion())) {
            return false;
        }
        var approval = json.readTree(model.getApprovedNoseCapabilities());
        var binding = request.binding();
        var review = request.review();
        return request.schemaVersion() != null
                && request.schemaVersion().equals(approval.path("schemaVersion").asString())
                && binding.equals(json.treeToValue(approval.path("binding"), Binding.class))
                && validHash(binding.meshSha256())
                && validHash(binding.rigSha256())
                && binding.meshSha256().equals(review.meshSha256())
                && DEFINITION.equals(review.definition())
                && UNIT.equals(review.unit())
                && QUALITY.equals(review.anatomicalQuality())
                && review.observedBounds() != null
                && review.observedBounds().keySet().equals(Set.of(ALAR, EYES))
                && review.observedBounds().values().stream()
                        .allMatch(BaselineMeasurementService::validBounds);
    }

    private ObjectNode measurements(FaceModel model) {
        if (model.getMeasurementsJson() == null) {
            return json.createObjectNode();
        }
        if (json.readTree(model.getMeasurementsJson()) instanceof ObjectNode object) {
            return object;
        }
        throw new IllegalArgumentException("invalid measurement storage");
    }

    private static boolean validHash(String hash) {
        return hash != null && hash.matches("[a-f0-9]{64}");
    }

    private static boolean validBounds(List<Double> bounds) {
        return bounds != null
                && bounds.size() == 2
                && bounds.stream()
                        .allMatch(value -> value != null && Double.isFinite(value) && value > 0)
                && bounds.getFirst() <= bounds.getLast();
    }

    private static BaselineMeasurementResponse response(BaselineMeasurementRequest.Review review) {
        return new BaselineMeasurementResponse(
                Status.AVAILABLE,
                List.of(
                        observation(ALAR, "콧볼 바깥쪽 사이 가로 거리", review),
                        observation(EYES, "눈 안쪽 사이 가로 거리", review)));
    }

    private static Observation observation(
            String code, String label, BaselineMeasurementRequest.Review review) {
        List<Double> bounds = review.observedBounds().get(code);
        return new Observation(
                code,
                label,
                DEFINITION,
                UNIT,
                QUALITY,
                bounds.getFirst(),
                bounds.getLast(),
                SOURCE);
    }

    private static BusinessException invalidReview() {
        return new BusinessException(CommonErrorCode.INVALID_REQUEST, "invalid baseline review");
    }
}
