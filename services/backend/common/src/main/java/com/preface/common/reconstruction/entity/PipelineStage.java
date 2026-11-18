package com.preface.common.reconstruction.entity;

/**
 * 단계 기록({@code reconstruction_job_stage.stage})의 단계. DDL {@code ck_job_stage_stage}와 같다(V27).
 *
 * <p>화면 4단계({@link ReconstructionStage})에 앞단의 프레임 추출({@link #EXTRACT})을 더한 것이다. 선언 순서가 처리 순서다.
 */
public enum PipelineStage {
    EXTRACT,
    FRAME_SELECT,
    QUALITY_CHECK,
    RECONSTRUCT,
    FINALIZE
}
