package com.preface.common.simulation.repository;

import com.preface.common.simulation.entity.MorphChange;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MorphChangeRepository extends JpaRepository<MorphChange, String> {

    Optional<MorphChange> findBySimulationIdAndSeq(String simulationId, int seq);

    List<MorphChange> findBySimulationId(String simulationId);

    List<MorphChange> findBySimulationIdAndSeqLessThanEqualOrderBySeqDesc(
            String simulationId, int seq);

    /** 새 변경 전에 redo 이력(포인터 뒤)을 지운다. */
    @Modifying(flushAutomatically = true)
    @Query("delete from MorphChange m where m.simulationId = :simulationId and m.seq > :seq")
    int deleteAfter(@Param("simulationId") String simulationId, @Param("seq") int seq);

    /** 상한(50단계)을 넘는 오래된 이력을 지운다. */
    @Modifying(flushAutomatically = true)
    @Query("delete from MorphChange m where m.simulationId = :simulationId and m.seq < :seq")
    int deleteBefore(@Param("simulationId") String simulationId, @Param("seq") int seq);
}
