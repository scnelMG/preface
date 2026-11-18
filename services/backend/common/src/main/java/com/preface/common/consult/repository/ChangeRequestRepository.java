package com.preface.common.consult.repository;

import com.preface.common.consult.entity.ChangeRequest;
import com.preface.common.consult.entity.ChangeRequestStatus;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChangeRequestRepository extends JpaRepository<ChangeRequest, String> {

    Optional<ChangeRequest> findByIdAndSimulationId(String id, String simulationId);

    /** "더/덜"과 AI 문맥용 직전 성공 거래. */
    Optional<ChangeRequest> findFirstBySimulationIdAndStatusOrderByAppliedAtDesc(
            String simulationId, ChangeRequestStatus status);

    /** API-CON-02. 메시지 페이지에 딸린 변경 요청. */
    List<ChangeRequest> findByConsultMessageIdIn(Collection<String> consultMessageIds);
}
