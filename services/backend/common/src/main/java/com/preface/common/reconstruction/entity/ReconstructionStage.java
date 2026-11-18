package com.preface.common.reconstruction.entity;

/** 화면 4단계와 1:1인 진행 단계. 선언 순서가 화면 순서다({@link #index()}). */
public enum ReconstructionStage {
    FRAME_SELECT,
    QUALITY_CHECK,
    RECONSTRUCT,
    FINALIZE;

    /** 화면 단계 번호(1~4). */
    public int index() {
        return ordinal() + 1;
    }
}
