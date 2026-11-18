package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.preface.common.error.BusinessException;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class WeightShapeBackfillCommitterTest {
    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final EyeEditService eye = mock(EyeEditService.class);
    private final WeightShapeBackfillCommitter committer =
            new WeightShapeBackfillCommitter(models, eye);

    @Test
    void 잠근_모델이_검증_당시와_같으면_원본을_보존하고_새_메시를_연다() {
        FaceModel model = model();
        when(models.findOwnedForUpdate("model", "user")).thenReturn(Optional.of(model));
        committer.commit(proof("old.glb"));
        assertThat(model.getSourceMeshObjectKey()).isEqualTo("old.glb");
        assertThat(model.getMeshObjectKey()).isEqualTo("new.glb");
        assertThat(model.getApprovedWeightShape()).isEqualTo("weight");
        assertThat(model.isChatApplyReady()).isFalse();
    }

    @Test
    void 검증_중_메시가_바뀌면_승인을_저장하지_않는다() {
        FaceModel model = model();
        when(models.findOwnedForUpdate("model", "user")).thenReturn(Optional.of(model));
        assertThatThrownBy(() -> committer.commit(proof("stale.glb")))
                .isInstanceOf(BusinessException.class);
        assertThat(model.getSourceMeshObjectKey()).isNull();
        assertThat(model.getMeshObjectKey()).isEqualTo("old.glb");
        verifyNoInteractions(eye);
    }

    private static FaceModel model() {
        return FaceModel.create(
                "user", "job", "old.glb", null, null, null, null, "GLB", "v2", null);
    }

    @Test
    void 윤곽을_추가할_때_원본과_직전_체중_GLB를_함께_추적한다() {
        FaceModel model = model();
        model.activateWeightShapeMesh("old.glb", "weight.glb", null, "previous-weight");
        when(models.findOwnedForUpdate("model", "user")).thenReturn(Optional.of(model));
        var proof =
                new WeightShapeBackfillCommitter.Proof(
                        "model",
                        "user",
                        "weight.glb",
                        null,
                        "v2",
                        null,
                        null,
                        "previous-weight",
                        "contour.glb",
                        null,
                        "rebound-weight",
                        null);
        assertThatThrownBy(() -> committer.commitContourRecovery(proof, "stale-source.glb"))
                .isInstanceOf(BusinessException.class);
        committer.commitContourRecovery(proof, "old.glb");
        assertThat(model.getSourceMeshObjectKey()).isEqualTo("old.glb");
        assertThat(model.getPreviousMeshObjectKey()).isEqualTo("weight.glb");
        assertThat(model.getMeshObjectKey()).isEqualTo("contour.glb");
        assertThat(model.getApprovedWeightShape()).isEqualTo("rebound-weight");
        assertThatThrownBy(() -> committer.commitContourRecovery(proof, "old.glb"))
                .isInstanceOf(BusinessException.class);
    }

    private static WeightShapeBackfillCommitter.Proof proof(String old) {
        return new WeightShapeBackfillCommitter.Proof(
                "model", "user", old, null, "v2", null, null, null, "new.glb", null, "weight",
                null);
    }
}
