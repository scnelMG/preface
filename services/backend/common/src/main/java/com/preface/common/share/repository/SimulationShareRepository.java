package com.preface.common.share.repository;

import com.preface.common.share.entity.SimulationShare;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SimulationShareRepository extends JpaRepository<SimulationShare, String> {

    Optional<SimulationShare> findByTokenHash(String tokenHash);

    List<SimulationShare> findAllBySimulationIdOrderByCreatedAtDesc(String simulationId);

    Optional<SimulationShare> findByIdAndUserId(String id, String userId);
}
