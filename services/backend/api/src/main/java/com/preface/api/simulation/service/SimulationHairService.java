package com.preface.api.simulation.service;

import com.preface.api.hair.service.HairTemplateService;
import com.preface.api.simulation.dto.SimulationHairResponse;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.SimulationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 시안 헤어 적용·해제(API-HAIR-02, S15P31B204-551). undo 대상이 아니라 가중치·{@code stateVersion}을 건드리지 않는다. 편집과 같은
 * 행 잠금으로 동시에 온 편집·삭제와 한 줄로 세운다.
 */
@Service
@RequiredArgsConstructor
public class SimulationHairService {

    private final SimulationRepository simulationRepository;
    private final HairTemplateService hairTemplateService;

    /** 남의 것·삭제된 시안은 COMMON_002, 없거나 노출하지 않는 템플릿은 EDIT_010. {@code null}이면 해제. */
    @Transactional
    public SimulationHairResponse apply(String userId, String simulationId, String hairTemplateId) {
        Simulation simulation =
                simulationRepository
                        .findOwnedForUpdate(simulationId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        if (hairTemplateId != null) {
            hairTemplateService.requireActive(hairTemplateId);
        }
        simulation.applyHair(hairTemplateId);
        simulationRepository.flush(); // updatedAt을 응답에 싣는다
        return new SimulationHairResponse(
                simulation.getId(), simulation.getHairTemplateId(), simulation.getUpdatedAt());
    }
}
