package com.preface.api.comparison.service;

import com.preface.api.comparison.dto.FirstComparisonResponse;
import com.preface.api.comparison.dto.FirstComparisonResponse.Proposal;
import com.preface.api.facemodel.dto.BaselineMeasurementResponse.Observation;
import com.preface.api.facemodel.service.BaselineMeasurementService;
import com.preface.api.simulation.service.MorphEdits;
import com.preface.api.simulation.service.MorphParameterService;
import com.preface.api.simulation.service.MorphStateCodec;
import com.preface.api.simulation.service.NoseEditService;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.simulation.repository.SimulationRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class FirstComparisonService {
    private static final String ALAR = "nose.alar_width";
    private static final double SMALL_STEP = -0.05;
    private static final String EVIDENCE = "https://pmc.ncbi.nlm.nih.gov/articles/PMC9337225/";

    private final SimulationRepository simulations;
    private final BaselineMeasurementService measurements;
    private final MorphStateCodec codec;
    private final MorphParameterService parameters;
    private final NoseEditService nose;

    public FirstComparisonResponse preview(String userId, String simulationId) {
        var simulation =
                simulations
                        .findByIdAndUserIdAndDeletedAtIsNull(simulationId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        var state = codec.read(simulation.getMorphState());
        if (state.weights().values().stream().anyMatch(weight -> weight != 0)
                || !state.pointStrokes().isEmpty()
                || state.eyeEdit() != null) {
            return deferred("조절값이 없는 시안에서 원본과 비교할 수 있어요.");
        }
        var observations = measurements.read(userId, simulation.getFaceModelId()).observations();
        if (observations.isEmpty()) {
            return deferred("이 모델의 원본 측정 검수가 아직 준비되지 않았어요.");
        }
        var alar = find(observations, "alarWidth");
        var eyes = find(observations, "intercanthalDistance");
        if (alar == null || eyes == null || alar.lower() <= eyes.upper()) {
            return deferred("원본의 두 측정 범위로 비교 방향을 정하기 어려워요.");
        }

        var catalog = parameters.ranges(state.schemaVersion());
        var capabilities = nose.capabilities(simulation, catalog);
        var range = capabilities == null ? null : capabilities.supported().get(ALAR);
        if (range == null || range.min() >= 0) {
            return deferred("이 모델은 콧볼 너비 비교를 지원하지 않아요.");
        }
        var requested = new MorphEdits.Requested(ALAR, Math.max(SMALL_STEP, range.min()));
        try {
            var candidate = MorphEdits.apply(state.weights(), List.of(requested), catalog);
            var checked =
                    nose.validate(
                            simulation, state.weights(), candidate, catalog, List.of(), false);
            double value = checked.weights().getOrDefault(ALAR, 0.0);
            if (!Double.isFinite(value) || value >= 0 || value < requested.value()) {
                return deferred("현재 모델에서 비교할 변화를 확인하기 어려워요.");
            }
            return new FirstComparisonResponse(
                    new Proposal(
                            simulation.getStateVersion(),
                            ALAR,
                            value,
                            "원본의 콧볼 가로 너비가 눈 안쪽 사이 거리보다 넓게 관찰됐어요. 콧볼을 조금 좁힌 모습과 원본을 비교해 보세요.",
                            EVIDENCE),
                    null);
        } catch (BusinessException e) {
            return deferred("이 모델에서 비교할 수 있는 형상을 확인하지 못했어요.");
        }
    }

    private static Observation find(List<Observation> observations, String code) {
        return observations.stream()
                .filter(observation -> observation.code().equals(code))
                .findFirst()
                .orElse(null);
    }

    private static FirstComparisonResponse deferred(String reason) {
        return new FirstComparisonResponse(null, reason);
    }
}
