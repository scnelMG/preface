package com.preface.common.hair.repository;

import com.preface.common.hair.entity.HairTemplate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HairTemplateRepository extends JpaRepository<HairTemplate, String> {

    List<HairTemplate> findAllByActiveTrueOrderBySortOrderAsc();

    Optional<HairTemplate> findByIdAndActiveTrue(String id);
}
