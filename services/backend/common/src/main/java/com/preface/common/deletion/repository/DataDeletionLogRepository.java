package com.preface.common.deletion.repository;

import com.preface.common.deletion.entity.DataDeletionLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DataDeletionLogRepository extends JpaRepository<DataDeletionLog, String> {

    boolean existsByTargetTypeAndTargetId(String targetType, String targetId);
}
