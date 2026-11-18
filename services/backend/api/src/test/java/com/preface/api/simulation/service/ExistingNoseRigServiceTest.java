package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.EyeCapabilities;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.deletion.repository.DataDeletionLogRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.MorphChange;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.MorphChangeRepository;
import com.preface.common.simulation.repository.SimulationRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

class ExistingNoseRigServiceTest {
    private static final String OLD = "nose-engine-0.12.0";
    private static final String NEW = "nose-engine-0.13.0";
    private static final String RIG = "users/owner/models/job/rig.json";
    private static final String EMPTY = "{\"schemaVersion\":\"v1\",\"weights\":{}}";
    private static final String SAVED =
            "{\"schemaVersion\":\"v1\",\"weights\":{\"nose.bridge_height\":0.5}}";
    private final JsonMapper json = JsonMapper.builder().build();
    private final MorphStateCodec codec = new MorphStateCodec(json);
    private final FaceModelRepository models = mock(FaceModelRepository.class);
    private final SimulationRepository simulations = mock(SimulationRepository.class);
    private final MorphChangeRepository history = mock(MorphChangeRepository.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private final NoseEditService nose = mock(NoseEditService.class);
    private final EyeEditService eyes = mock(EyeEditService.class);
    private final DataDeletionLogRepository deletionLog = mock(DataDeletionLogRepository.class);
    private final ExistingNoseRigService service =
            new ExistingNoseRigService(
                    models,
                    simulations,
                    history,
                    storage,
                    nose,
                    eyes,
                    codec,
                    deletionLog,
                    json,
                    new TransactionTemplate(mock(PlatformTransactionManager.class)));
    private final FaceModel model =
            FaceModel.create("owner", "job", "mesh", RIG, null, null, null, "GLB", "v1", null);
    private final Simulation simulation = Simulation.create("owner", "model", "시안", SAVED);
    private final byte[] original = rig(OLD, 1);
    private final byte[] candidate = rig(NEW, 1);
    private final String candidateKey = ExistingNoseRigService.candidateKey(RIG, hash(candidate));
    private final NoseApprovalRequest request =
            new NoseApprovalRequest(
                    "v1",
                    new NoseApprovalRequest.Binding(
                            "mesh", hash(candidate), "fit", NEW, "rig", "topology"),
                    Map.of("nose.bridge_height", new NoseApprovalRequest.Range(-1.0, 1.0)));

    @BeforeEach
    void setup() {
        ReflectionTestUtils.setField(model, "id", "model");
        model.approveNose(
                json.writeValueAsString(
                        new NoseEditService.Approval(
                                "v1",
                                new NoseEditValidation.Binding(
                                        "mesh", hash(original), "fit", OLD, "rig", "topology"),
                                Map.of("nose.bridge_height", new NoseEditService.Bounds(-1, 1)))));
        ReflectionTestUtils.setField(simulation, "id", "simulation");
        when(models.findById("model")).thenReturn(Optional.of(model));
        when(models.findOwnedForUpdate("model", "owner")).thenReturn(Optional.of(model));
        when(storage.readMesh(RIG)).thenReturn(original);
        when(storage.readMesh(candidateKey)).thenReturn(candidate);
        when(nose.validateForGeneration("mesh", candidateKey, request)).thenReturn("verified");
        when(simulations.findAllByFaceModelIdAndDeletedAtIsNullOrderById("model"))
                .thenReturn(List.of(simulation));
        when(simulations.findActiveModelSimulationsForUpdate("model"))
                .thenReturn(List.of(simulation));
    }

    @Test
    void 현재값과_되돌리기_이력을_검사하고_같은_시안을_전환한다() {
        MorphChange change = mock(MorphChange.class);
        when(change.getStateAfter()).thenReturn(EMPTY);
        when(history.findBySimulationId("simulation")).thenReturn(List.of(change));

        service.upgrade("model", request);

        verify(nose)
                .verifySavedNoseStates(
                        "mesh",
                        candidateKey,
                        "verified",
                        Set.of(codec.read(SAVED), codec.read(EMPTY)));
        assertThat(model.getRigObjectKey()).isEqualTo(candidateKey);
        assertThat(model.getSourceRigObjectKey()).isEqualTo(RIG);
        assertThat(model.getApprovedNoseCapabilities()).isEqualTo("verified");
        assertThat(simulation.getMorphState()).isEqualTo(SAVED);
        assertThat(simulation.getStateVersion()).isEqualTo(1);
    }

    @Test
    void 검사_중_시안이_바뀌면_전환하지_않는다() {
        Simulation newer = Simulation.create("owner", "model", "시안", SAVED);
        ReflectionTestUtils.setField(newer, "id", "simulation");
        newer.invalidateEditorVersion();
        when(simulations.findActiveModelSimulationsForUpdate("model")).thenReturn(List.of(newer));

        assertThatThrownBy(() -> service.upgrade("model", request))
                .isInstanceOf(BusinessException.class);

        assertThat(model.getRigObjectKey()).isEqualTo(RIG);
        assertThat(simulation.getStateVersion()).isZero();
    }

    @Test
    void 엔진_버전_외의_리그_변경은_거절한다() {
        byte[] changed = rig(NEW, 2);
        assertThatThrownBy(
                        () ->
                                service.verifySameRig(
                                        original, hash(original), changed, hash(changed)))
                .isInstanceOf(BusinessException.class);
        verify(nose, never()).validateForGeneration(eq("mesh"), any(), any());
    }

    @ParameterizedTest
    @CsvSource({"-8, 5.25", "-5.25, 15", "-5.25, 5.25"})
    void 콧대_범위를_줄여도_기존_이력과_원본_리그를_유지한다(double lower, double upper) {
        byte[] first = bridgeRig(-8, 15, 10);
        byte[] narrowed = bridgeRig(lower, upper, 10);
        String firstKey = ExistingNoseRigService.candidateKey(RIG, hash(first));
        String narrowedKey = ExistingNoseRigService.candidateKey(RIG, hash(narrowed));
        model.upgradeNoseRig(
                firstKey,
                json.writeValueAsString(
                        new NoseEditService.Approval(
                                "v1",
                                new NoseEditValidation.Binding(
                                        "mesh", hash(first), "fit", NEW, "rig", "topology"),
                                Map.of("nose.bridge_height", new NoseEditService.Bounds(-1, 1)))),
                null);
        var recalibration =
                new NoseApprovalRequest(
                        "v1",
                        new NoseApprovalRequest.Binding(
                                "mesh", hash(narrowed), "fit", NEW, "rig", "topology"),
                        request.ranges());
        when(storage.readMesh(firstKey)).thenReturn(first);
        when(storage.readMesh(narrowedKey)).thenReturn(narrowed);
        when(nose.validateForGeneration("mesh", narrowedKey, recalibration)).thenReturn("verified");

        service.upgrade("model", recalibration);

        verify(nose)
                .verifySavedNoseStates("mesh", narrowedKey, "verified", Set.of(codec.read(SAVED)));
        assertThat(model.getRigObjectKey()).isEqualTo(narrowedKey);
        assertThat(model.getSourceRigObjectKey()).isEqualTo(RIG);
        assertThat(simulation.getMorphState()).isEqualTo(SAVED);
        assertThat(simulation.getStateVersion()).isEqualTo(1);
        var cleanup = ArgumentCaptor.forClass(DataDeletionLog.class);
        verify(deletionLog).save(cleanup.capture());
        assertThat(cleanup.getValue().getObjectKey()).isEqualTo(firstKey);
    }

    @Test
    void 콧대_상한_확대나_다른_변형_변경은_거절한다() {
        byte[] first = bridgeRig(-8, 15, 10);
        for (byte[] changed :
                List.of(
                        bridgeRig(-8, 16, 10),
                        bridgeRig(-9, 15, 10),
                        bridgeRig(0, 15, 10),
                        bridgeRig(-9, 5, 10),
                        bridgeRig(-8, 5, 11))) {
            assertThatThrownBy(
                            () -> service.verifySameRig(first, hash(first), changed, hash(changed)))
                    .isInstanceOf(BusinessException.class);
        }
    }

    @Test
    void 눈_결속_검증이_실패하면_기존_리그와_눈_승인을_유지한다() {
        model.approveEyes("prior-eye");
        var review = new EyeReview("absent", "absent");
        var approved =
                new EyeCapabilities(
                        "v1",
                        "mesh",
                        hash(original),
                        "parts",
                        OLD,
                        "rig",
                        "topology",
                        Map.of("inner", 20.0));
        when(eyes.support("model"))
                .thenReturn(new EyeEditService.Support(review, approved, "parts"));

        assertThatThrownBy(() -> service.upgrade("model", request))
                .isInstanceOf(BusinessException.class);

        verify(eyes).verifyAssets(eq("mesh"), eq(candidateKey), any(), any());
        assertThat(model.getRigObjectKey()).isEqualTo(RIG);
        assertThat(model.getApprovedEyeCapabilities()).isEqualTo("prior-eye");
    }

    @Test
    void 리그가_없는_모델의_복원_후보를_검사하고_연결한다() {
        String meshKey = "users/owner/models/job/mesh.glb";
        FaceModel legacy =
                FaceModel.create(
                        "owner", "job", meshKey, null, null, null, null, "GLB", "v1", null);
        when(models.findById("model")).thenReturn(Optional.of(legacy));
        when(models.findOwnedForUpdate("model", "owner")).thenReturn(Optional.of(legacy));
        when(nose.validateForGeneration(meshKey, candidateKey, request)).thenReturn("verified");

        service.upgrade("model", request);

        assertThat(legacy.getRigObjectKey()).isEqualTo(candidateKey);
        assertThat(legacy.getSourceRigObjectKey()).isNull();
        verify(nose)
                .verifySavedNoseStates(
                        meshKey, candidateKey, "verified", Set.of(codec.read(SAVED)));
    }

    private static byte[] rig(String engine, int scale) {
        return ("{\"nose\":{\"engine\":\"" + engine + "\",\"scale\":" + scale + "}}")
                .getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] bridgeRig(double lower, double upper, int alarUpper) {
        return """
                {"nose":{"engine":"%s","limits":{"dorsum_height":[%s,%s],"alar_width":[-10,%d]}}}
                """
                .formatted(NEW, lower, upper, alarUpper)
                .getBytes(StandardCharsets.UTF_8);
    }

    private static String hash(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
