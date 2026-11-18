package com.preface.common.reconstruction.repository;

import com.preface.common.reconstruction.entity.JobStageStatus;
import com.preface.common.reconstruction.entity.ReconstructionJobStage;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** 복원 작업 단계별 기록(V27). 행은 워커 보고·회수·취소가 작업 행을 바꾸는 같은 트랜잭션에서 남긴다(S15P31B204-652). */
public interface ReconstructionJobStageRepository
        extends JpaRepository<ReconstructionJobStage, String> {

    /** 한 작업의 단계 기록을 시작 순서대로. */
    List<ReconstructionJobStage> findAllByJobIdOrderByStartedAtAscIdAsc(String jobId);

    /** 한 작업의 특정 상태 행(보통 진행 중인 행). {@code idx_job_stage_job}을 탄다. */
    List<ReconstructionJobStage> findAllByJobIdAndStatus(String jobId, JobStageStatus status);
}
