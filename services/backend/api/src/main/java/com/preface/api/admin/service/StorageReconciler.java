package com.preface.api.admin.service;

import com.preface.api.admin.dto.AdminStorageResponse.StorageObject;
import com.preface.api.admin.service.AdminStorage.Listing;
import com.preface.api.admin.service.AdminStorage.StoredObject;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * S3 나열 결과와 DB key를 대조한다(S15P31B204-653). DB·S3를 부르지 않는 순수 계산이라 단위 테스트로 상태 규칙을 고정한다.
 *
 * <ul>
 *   <li>{@code DELETE_FAILED}: S3에 있고 삭제 기록이 FAILED(삭제를 끝내 못 함)
 *   <li>{@code OK}: S3에 있고 DB 행이 key를 가리킨다
 *   <li>{@code S3_ONLY}: S3에만 있다(실패한 GPU 시도의 출력, 삭제 대기 중인 key 등)
 *   <li>{@code DB_ONLY}: DB 행은 key를 가리키는데 S3에 없다
 * </ul>
 *
 * <p>나열이 상한에서 잘렸으면 마지막으로 받은 key보다 뒤인 DB key는 S3에 있는지 모르므로 {@code DB_ONLY}로 내지 않는다(ListObjectsV2는
 * key 순서로 준다).
 */
final class StorageReconciler {

    static final String OK = "OK";
    static final String DB_ONLY = "DB_ONLY";
    static final String S3_ONLY = "S3_ONLY";
    static final String DELETE_FAILED = "DELETE_FAILED";

    /** 삭제 기록에만 있는 key의 source. */
    static final String SOURCE_DELETION_LOG = "DELETION_LOG";

    private StorageReconciler() {}

    /**
     * @param source key를 가진 DB 표
     * @param deleteScheduledAt 보관 규칙상 지울 시각(없으면 null)
     */
    record DbKey(String source, Instant deleteScheduledAt) {}

    /**
     * @param failed 삭제 기록이 FAILED인가(아니면 PENDING)
     * @param scheduledAt 삭제 기록이 생긴 시각(이때부터 삭제 대기)
     */
    record DeletionMark(boolean failed, Instant scheduledAt) {}

    static List<StorageObject> reconcile(
            String prefix,
            Listing listing,
            Map<String, DbKey> dbKeys,
            Map<String, DeletionMark> deletions) {
        List<StorageObject> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        String lastKey = null;
        for (StoredObject object : listing.objects()) {
            String key = object.key();
            seen.add(key);
            if (lastKey == null || key.compareTo(lastKey) > 0) {
                lastKey = key;
            }
            DbKey db = dbKeys.get(key);
            DeletionMark mark = deletions.get(key);
            String source = db != null ? db.source() : mark != null ? SOURCE_DELETION_LOG : null;
            String state;
            if (mark != null && mark.failed()) {
                state = DELETE_FAILED;
            } else if (db != null) {
                state = OK;
            } else {
                state = S3_ONLY;
            }
            result.add(
                    new StorageObject(
                            key,
                            object.size(),
                            object.lastModified(),
                            source,
                            scheduledAt(db, mark),
                            state));
        }
        for (Map.Entry<String, DbKey> entry : dbKeys.entrySet()) {
            String key = entry.getKey();
            if (seen.contains(key) || !key.startsWith(prefix)) {
                continue;
            }
            if (listing.truncated() && (lastKey == null || key.compareTo(lastKey) > 0)) {
                continue;
            }
            DbKey db = entry.getValue();
            result.add(
                    new StorageObject(
                            key,
                            null,
                            null,
                            db.source(),
                            scheduledAt(db, deletions.get(key)),
                            DB_ONLY));
        }
        result.sort(Comparator.comparing(StorageObject::key));
        return result;
    }

    /** 이미 삭제 기록이 있으면 그 시각, 아니면 보관 규칙상 시각. 둘 다 있으면 이른 쪽. */
    private static Instant scheduledAt(DbKey db, DeletionMark mark) {
        Instant byRule = db == null ? null : db.deleteScheduledAt();
        Instant byLog = mark == null ? null : mark.scheduledAt();
        if (byRule == null) {
            return byLog;
        }
        if (byLog == null) {
            return byRule;
        }
        return byRule.isBefore(byLog) ? byRule : byLog;
    }
}
