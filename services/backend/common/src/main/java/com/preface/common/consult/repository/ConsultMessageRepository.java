package com.preface.common.consult.repository;

import com.preface.common.consult.entity.ConsultMessage;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ConsultMessageRepository extends JpaRepository<ConsultMessage, String> {

    /** 다음 메시지 순번 계산용. 메시지가 없으면 0. 시안 행 잠금 안에서 부른다. */
    @Query(
            "select coalesce(max(m.seq), 0) from ConsultMessage m"
                    + " where m.simulationId = :simulationId")
    int maxSeq(@Param("simulationId") String simulationId);

    /** AI에 넘길 최근 대화. 최신순이라 호출한 쪽이 뒤집는다. */
    List<ConsultMessage> findTop10BySimulationIdOrderBySeqDesc(String simulationId);

    /** 선택지 검사용 마지막 메시지. */
    Optional<ConsultMessage> findFirstBySimulationIdOrderBySeqDesc(String simulationId);

    /** API-CON-02. 정렬은 호출한 쪽 Pageable(seq 오름차순). */
    Page<ConsultMessage> findBySimulationId(String simulationId, Pageable pageable);

    Page<ConsultMessage> findBySimulationIdAndSeqGreaterThan(
            String simulationId, int seq, Pageable pageable);

    Page<ConsultMessage> findBySimulationIdAndSeqLessThanEqual(
            String simulationId, int seq, Pageable pageable);
}
