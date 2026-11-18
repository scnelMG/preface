package com.preface.jobmanager.deletion.service;

import com.preface.common.deletion.entity.DataDeletionLog;

/**
 * {@code data_deletion_log}의 {@code target_type}·{@code reason}·{@code status} 값. 근거는 V1 DDL 컬럼
 * 주석(CHECK는 status에만 있다).
 */
final class DeletionCodes {

    static final String TARGET_FACE_UPLOAD = DataDeletionLog.TARGET_FACE_UPLOAD;
    static final String TARGET_SIMULATION = "SIMULATION";

    /** 복원 입력 프레임 묶음 1개(target_id = face_upload.id, V8). */
    static final String TARGET_FACE_UPLOAD_FRAMES = DataDeletionLog.TARGET_FACE_UPLOAD_FRAMES;

    static final String REASON_RETENTION_POLICY = DataDeletionLog.REASON_RETENTION_POLICY;
    static final String REASON_SOFT_DELETE_EXPIRED = "SOFT_DELETE_EXPIRED";
    static final String REASON_EMPTY_SIMULATION = "EMPTY_SIMULATION";

    static final String STATUS_PENDING = DataDeletionLog.STATUS_PENDING;
    static final String STATUS_DONE = "DONE";
    static final String STATUS_FAILED = "FAILED";

    private DeletionCodes() {}
}
