package com.preface.api.simulation.service;

import com.preface.api.simulation.dto.SimulationListResponse;
import com.preface.api.simulation.dto.SimulationTitleResponse;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 시안 이력: 목록·이름 바꾸기·삭제(API-HIS-05·06·07). 편집은 {@link SimulationService}.
 *
 * <p>빈 시안({@code has_changes=0})은 목록에서 빼고, 지우면 바로 물리 삭제한다(이력·대화는 FK CASCADE). 변경 있는 시안은 {@code
 * deleted_at} 소프트 삭제 후 30일 뒤 삭제 배치가 지운다(FN-HIS-03).
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SimulationHistoryService {

    static final int MAX_PAGE_SIZE = 50;

    private final SimulationRepository simulationRepository;
    private final MorphParameterService morphParameterService;
    private final MorphStateCodec codec;
    private final Clock clock;

    /** API-HIS-06. 최근 수정순(같으면 ID 내림차순). {@code faceModelId}가 남의 3D면 결과가 비어 있다. */
    public SimulationListResponse list(String userId, String faceModelId, int page, int size) {
        int safePage = Math.max(page, 0);
        int safeSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
        Pageable pageable =
                PageRequest.of(
                        safePage,
                        safeSize,
                        Sort.by(Sort.Order.desc("updatedAt"), Sort.Order.desc("id")));
        Page<Simulation> result =
                faceModelId == null || faceModelId.isBlank()
                        ? simulationRepository.findByUserIdAndHasChangesTrueAndDeletedAtIsNull(
                                userId, pageable)
                        : simulationRepository
                                .findByUserIdAndFaceModelIdAndHasChangesTrueAndDeletedAtIsNull(
                                        userId, faceModelId, pageable);

        Map<String, Map<String, ChangedParts.PartOf>> partsBySchema = new HashMap<>();
        List<SimulationListResponse.Item> items =
                result.getContent().stream()
                        .map(
                                s -> {
                                    var state = codec.read(s.getMorphState());
                                    var parts =
                                            partsBySchema.computeIfAbsent(
                                                    state.schemaVersion(),
                                                    morphParameterService::partsByCode);
                                    return new SimulationListResponse.Item(
                                            s.getId(),
                                            s.getFaceModelId(),
                                            s.getTitle(),
                                            ChangedParts.of(state.weights(), parts),
                                            s.getCreatedAt(),
                                            s.getUpdatedAt());
                                })
                        .toList();
        return new SimulationListResponse(items, safePage, safeSize, result.getTotalElements());
    }

    /** API-HIS-05. 이름만 바꾼다. 같은 이름이 있어도 번호를 붙이지 않는다(번호는 생성 때 기본 이름에만). */
    @Transactional
    public SimulationTitleResponse rename(String userId, String simulationId, String title) {
        String trimmed = title == null ? "" : title.strip();
        if (trimmed.isEmpty() || trimmed.length() > 100) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST, "title must be 1~100");
        }
        Simulation simulation = owned(simulationId, userId);
        simulation.rename(trimmed);
        simulationRepository.flush(); // updatedAt(@LastModifiedDate)을 응답에 싣는다
        return new SimulationTitleResponse(
                simulation.getId(), simulation.getTitle(), simulation.getUpdatedAt());
    }

    /** API-HIS-07. 변경 있는 시안 = 소프트 삭제, 빈 시안 = 즉시 물리 삭제. */
    @Transactional
    public void delete(String userId, String simulationId) {
        Simulation simulation = owned(simulationId, userId);
        if (simulation.isHasChanges()) {
            simulation.softDelete(clock.instant().truncatedTo(ChronoUnit.SECONDS));
        } else {
            simulationRepository.delete(simulation);
        }
    }

    /** 편집과 같은 행 잠금으로 편집 중인 요청과 한 줄로 세운다. */
    private Simulation owned(String simulationId, String userId) {
        return simulationRepository
                .findOwnedForUpdate(simulationId, userId)
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
    }
}
