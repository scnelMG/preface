package com.preface.api.admin.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.admin.dto.AdminStorageResponse.StorageObject;
import com.preface.api.admin.service.AdminStorage.Listing;
import com.preface.api.admin.service.AdminStorage.StoredObject;
import com.preface.api.admin.service.StorageReconciler.DbKey;
import com.preface.api.admin.service.StorageReconciler.DeletionMark;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** S3 나열과 DB key 대조 규칙(합성 key). */
class StorageReconcilerTest {

    private static final String PREFIX = "users/u-1/";
    private static final Instant T = Instant.parse("2026-11-07T00:00:00Z");

    @Test
    void DB와_S3에_둘_다_있으면_OK이고_source와_삭제_예정_시각을_싣는다() {
        var result =
                StorageReconciler.reconcile(
                        PREFIX,
                        listing(false, "users/u-1/models/j/a1/mesh.glb"),
                        Map.of(
                                "users/u-1/models/j/a1/mesh.glb",
                                new DbKey("FACE_MODEL", T.plusSeconds(60))),
                        Map.of());

        assertThat(result)
                .singleElement()
                .satisfies(
                        o -> {
                            assertThat(o.state()).isEqualTo("OK");
                            assertThat(o.source()).isEqualTo("FACE_MODEL");
                            assertThat(o.size()).isEqualTo(10L);
                            assertThat(o.deleteScheduledAt()).isEqualTo(T.plusSeconds(60));
                        });
    }

    @Test
    void S3에만_있으면_S3_ONLY이고_source는_null이다() {
        var result =
                StorageReconciler.reconcile(
                        PREFIX,
                        listing(false, "users/u-1/models/j/a1/rig.json"),
                        Map.of(),
                        Map.of());

        assertThat(result)
                .singleElement()
                .satisfies(
                        o -> {
                            assertThat(o.state()).isEqualTo("S3_ONLY");
                            assertThat(o.source()).isNull();
                        });
    }

    @Test
    void 삭제_대기_기록에만_있으면_S3_ONLY이고_기록_시각을_삭제_예정으로_준다() {
        var result =
                StorageReconciler.reconcile(
                        PREFIX,
                        listing(false, "users/u-1/uploads/up.mp4"),
                        Map.of(),
                        Map.of("users/u-1/uploads/up.mp4", new DeletionMark(false, T)));

        assertThat(result)
                .singleElement()
                .satisfies(
                        o -> {
                            assertThat(o.state()).isEqualTo("S3_ONLY");
                            assertThat(o.source()).isEqualTo("DELETION_LOG");
                            assertThat(o.deleteScheduledAt()).isEqualTo(T);
                        });
    }

    @Test
    void 삭제_기록이_FAILED인데_S3에_남아_있으면_DELETE_FAILED다() {
        var result =
                StorageReconciler.reconcile(
                        PREFIX,
                        listing(false, "users/u-1/models/j/a1/front.jpg"),
                        Map.of(
                                "users/u-1/models/j/a1/front.jpg",
                                new DbKey("FACE_CAPTURE_IMAGE", null)),
                        Map.of("users/u-1/models/j/a1/front.jpg", new DeletionMark(true, T)));

        assertThat(result)
                .singleElement()
                .satisfies(
                        o -> {
                            assertThat(o.state()).isEqualTo("DELETE_FAILED");
                            assertThat(o.source()).isEqualTo("FACE_CAPTURE_IMAGE");
                        });
    }

    @Test
    void DB에만_있으면_DB_ONLY이고_크기는_null이다() {
        var result =
                StorageReconciler.reconcile(
                        PREFIX,
                        listing(false),
                        Map.of("users/u-1/uploads/up.mp4", new DbKey("FACE_UPLOAD", T)),
                        Map.of());

        assertThat(result)
                .singleElement()
                .satisfies(
                        o -> {
                            assertThat(o.state()).isEqualTo("DB_ONLY");
                            assertThat(o.size()).isNull();
                            assertThat(o.lastModified()).isNull();
                        });
    }

    @Test
    void 나열이_잘렸으면_마지막_key_뒤의_DB_key는_DB_ONLY로_내지_않는다() {
        var result =
                StorageReconciler.reconcile(
                        PREFIX,
                        listing(true, "users/u-1/models/b"),
                        Map.of(
                                "users/u-1/models/a", new DbKey("FACE_MODEL", null),
                                "users/u-1/models/c", new DbKey("FACE_MODEL", null)),
                        Map.of());

        assertThat(result)
                .extracting(StorageObject::key, StorageObject::state)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("users/u-1/models/a", "DB_ONLY"),
                        org.assertj.core.groups.Tuple.tuple("users/u-1/models/b", "S3_ONLY"));
    }

    @Test
    void 다른_회원_prefix의_DB_key는_내지_않고_결과는_key_순이다() {
        var result =
                StorageReconciler.reconcile(
                        PREFIX,
                        listing(false, "users/u-1/z", "users/u-1/a"),
                        Map.of("users/u-2/x", new DbKey("FACE_MODEL", null)),
                        Map.of());

        assertThat(result)
                .extracting(StorageObject::key)
                .containsExactly("users/u-1/a", "users/u-1/z");
    }

    private static Listing listing(boolean truncated, String... keys) {
        return new Listing(
                List.of(keys).stream().map(k -> new StoredObject(k, 10L, T)).toList(), truncated);
    }
}
