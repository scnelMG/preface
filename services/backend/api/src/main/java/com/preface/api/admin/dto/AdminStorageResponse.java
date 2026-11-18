package com.preface.api.admin.dto;

import java.time.Instant;
import java.util.List;

/**
 * 관리자: 회원 한 명의 S3 보관 목록과 DB 대조(S15P31B204-653).
 *
 * @param truncated 객체가 나열 상한보다 많아 일부만 담았는가. 참이면 마지막으로 받은 key 뒤의 DB key는 대조하지 않는다
 * @param objects key 순. S3에 있는 객체와, DB에만 있는 key({@code DB_ONLY}, size·lastModified null)
 * @param deletionFailures {@code data_deletion_log} 중 FAILED(S3 삭제를 끝내 못 한 것)
 */
public record AdminStorageResponse(
        String userId,
        String prefix,
        Instant checkedAt,
        boolean truncated,
        List<StorageObject> objects,
        List<DeletionFailure> deletionFailures) {

    /**
     * @param source key를 가진 DB 표: {@code FACE_UPLOAD} | {@code FACE_UPLOAD_FRAMES} | {@code
     *     FACE_MODEL} | {@code FACE_CAPTURE_IMAGE} | {@code JOB_STAGE_LOG} | {@code
     *     DELETION_LOG}(삭제 대기 기록에만 있음). 어디에도 없으면 {@code null}
     * @param state {@code OK} | {@code DB_ONLY} | {@code S3_ONLY} | {@code DELETE_FAILED}
     */
    public record StorageObject(
            String key,
            Long size,
            Instant lastModified,
            String source,
            Instant deleteScheduledAt,
            String state) {}

    /**
     * @param reason 삭제 사유({@code data_deletion_log.reason}, 예: SOFT_DELETE_EXPIRED)
     */
    public record DeletionFailure(String objectKey, String reason, int retryCount) {}
}
