package com.preface.common.reconstruction.entity;

/** 단계 기록의 상태. DDL {@code ck_job_stage_status}와 같다(V27). */
public enum JobStageStatus {
    RUNNING,
    SUCCEEDED,
    FAILED
}
