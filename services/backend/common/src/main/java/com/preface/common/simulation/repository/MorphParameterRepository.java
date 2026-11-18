package com.preface.common.simulation.repository;

import com.preface.common.simulation.entity.MorphParameter;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MorphParameterRepository extends JpaRepository<MorphParameter, String> {

    List<MorphParameter> findAllBySchemaVersionAndActiveTrueOrderBySortOrderAsc(
            String schemaVersion);
}
