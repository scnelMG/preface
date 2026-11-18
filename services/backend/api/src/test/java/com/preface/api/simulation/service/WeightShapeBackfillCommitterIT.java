package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.preface.TestcontainersConfiguration;
import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.common.error.BusinessException;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class WeightShapeBackfillCommitterIT {
    @Autowired JdbcTemplate jdbc;
    @Autowired WeightShapeBackfillCommitter committer;
    @MockitoBean EyeEditService eyeApproval;
    private String user, upload, job, model;

    @BeforeEach
    void createSyntheticModel() {
        user = UUID.randomUUID().toString();
        upload = UUID.randomUUID().toString();
        job = UUID.randomUUID().toString();
        model = UUID.randomUUID().toString();
        jdbc.update("insert into user(id) values (?)", user);
        jdbc.update(
                "insert into face_upload(id,user_id,object_key,content_type,size_bytes,duration_ms,"
                        + "url_expires_at,retention_expires_at,checksum_sha256)"
                        + " values (?,?,'synthetic/video','video/mp4',1,1,now(),now(),?)",
                upload,
                user,
                "a".repeat(44));
        jdbc.update(
                "insert into reconstruction_job(id,user_id,face_upload_id,status)"
                        + " values (?,?,?,'SUCCEEDED')",
                job,
                user,
                upload);
        jdbc.update(
                "insert into face_model(id,user_id,reconstruction_job_id,mesh_object_key,"
                        + "mesh_format,morph_schema_version) values (?,?,?,'old.glb','GLB','v2')",
                model,
                user,
                job);
    }

    @AfterEach
    void removeSyntheticModel() {
        jdbc.update("delete from face_model where id=?", model);
        jdbc.update("delete from reconstruction_job where id=?", job);
        jdbc.update("delete from face_upload where id=?", upload);
        jdbc.update("delete from user where id=?", user);
    }

    @Test
    void 새_GLb_승인과_원본_키가_한_거래에서_저장된다() {
        committer.commit(proof(null));
        Map<String, Object> row =
                jdbc.queryForMap(
                        "select mesh_object_key,source_mesh_object_key,approved_weight_shape"
                                + " from face_model where id=?",
                        model);
        assertThat(row.get("mesh_object_key")).isEqualTo("new.glb");
        assertThat(row.get("source_mesh_object_key")).isEqualTo("old.glb");
        assertThat(row.get("approved_weight_shape").toString()).contains("meshSha256");
    }

    @Test
    void 눈_재승인이_실패하면_메시_전환도_롤백된다() {
        EyeApprovalRequest eye = new EyeApprovalRequest("v2", null, Map.of());
        assertThatThrownBy(() -> committer.commit(proof(eye)))
                .isInstanceOf(BusinessException.class);
        Map<String, Object> row =
                jdbc.queryForMap(
                        "select mesh_object_key,source_mesh_object_key,approved_weight_shape"
                                + " from face_model where id=?",
                        model);
        assertThat(row.get("mesh_object_key")).isEqualTo("old.glb");
        assertThat(row.get("source_mesh_object_key")).isNull();
        assertThat(row.get("approved_weight_shape")).isNull();
    }

    private WeightShapeBackfillCommitter.Proof proof(EyeApprovalRequest eye) {
        return new WeightShapeBackfillCommitter.Proof(
                model,
                user,
                "old.glb",
                null,
                "v2",
                null,
                null,
                null,
                "new.glb",
                null,
                "{\"meshSha256\":\"synthetic\"}",
                eye);
    }

    @Test
    void 윤곽_전환에서_눈_재승인이_실패하면_직전_체중_GLB가_유지된다() {
        committer.commit(proof(null));
        String oldWeight =
                jdbc.queryForObject(
                        "select approved_weight_shape from face_model where id=?",
                        String.class,
                        model);
        var eye = new EyeApprovalRequest("v2", null, Map.of());
        var contour =
                new WeightShapeBackfillCommitter.Proof(
                        model,
                        user,
                        "new.glb",
                        null,
                        "v2",
                        null,
                        null,
                        oldWeight,
                        "contour.glb",
                        null,
                        "{\"meshSha256\":\"new\"}",
                        eye);
        assertThatThrownBy(() -> committer.commitContourRecovery(contour, "old.glb"))
                .isInstanceOf(BusinessException.class);
        Map<String, Object> row =
                jdbc.queryForMap(
                        "select mesh_object_key,source_mesh_object_key,previous_mesh_object_key"
                                + " from face_model where id=?",
                        model);
        assertThat(row.get("mesh_object_key")).isEqualTo("new.glb");
        assertThat(row.get("source_mesh_object_key")).isEqualTo("old.glb");
        assertThat(row.get("previous_mesh_object_key")).isNull();
    }
}
