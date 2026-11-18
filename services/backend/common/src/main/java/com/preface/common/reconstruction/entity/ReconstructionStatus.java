package com.preface.common.reconstruction.entity;

/** 복원 작업 상태. {@code QUEUED → RUNNING → SUCCEEDED | FAILED}, 삭제·탈퇴·동의 철회 시 {@code CANCELED}. */
public enum ReconstructionStatus {
    QUEUED,
    RUNNING,
    SUCCEEDED,
    FAILED,
    CANCELED;

    /** 아직 끝나지 않은 상태. 사용자당 하나만 허용한다(REC_002). */
    public boolean inProgress() {
        return this == QUEUED || this == RUNNING;
    }

    public boolean terminal() {
        return !inProgress();
    }
}
