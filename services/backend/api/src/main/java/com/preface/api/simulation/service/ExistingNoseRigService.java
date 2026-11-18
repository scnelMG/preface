package com.preface.api.simulation.service;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.api.simulation.dto.MorphState;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.deletion.repository.DataDeletionLogRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.EditErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.MorphChangeRepository;
import com.preface.common.simulation.repository.SimulationRepository;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** 원본 리그의 매핑을 보존한 새 코 엔진을 재검사해 시안 이력과 함께 전환한다. */
@Service
@RequiredArgsConstructor
public class ExistingNoseRigService {
    private static final String LEGACY_ENGINE = "nose-engine-0.12.0";
    private static final String NEW_ENGINE = "nose-engine-0.13.0";

    private final FaceModelRepository models;
    private final SimulationRepository simulations;
    private final MorphChangeRepository history;
    private final ReconstructionStorage storage;
    private final NoseEditService nose;
    private final EyeEditService eyes;
    private final MorphStateCodec codec;
    private final DataDeletionLogRepository deletionLog;
    private final JsonMapper json;
    private final TransactionTemplate transactions;

    public void upgrade(String modelId, NoseApprovalRequest request) {
        FaceModel model =
                models.findById(modelId)
                        .filter(m -> !m.isDeleted())
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        String previousKey = model.getRigObjectKey();
        if (request.binding() == null
                || !NEW_ENGINE.equals(request.binding().engine())
                || !model.getMorphSchemaVersion().equals(request.schemaVersion())
                || !request.binding().rigSha256().matches("[a-f0-9]{64}")) throw invalid();

        String targetKey =
                candidateKey(
                        previousKey == null ? model.getMeshObjectKey() : previousKey,
                        request.binding().rigSha256());
        try {
            var previous = readApproval(model);
            if (targetKey.equals(previousKey)
                    && previous != null
                    && previous.binding() != null
                    && NEW_ENGINE.equals(previous.binding().engine())
                    && sameMeshBinding(previous.binding(), request.binding())
                    && request.binding().rigSha256().equals(previous.binding().rigSha256())) return;
            if (previousKey == null) {
                if (previous != null
                        || model.getSourceRigObjectKey() != null
                        || model.getApprovedEyeCapabilities() != null) throw invalid();
            } else {
                if (previous == null
                        || previous.binding() == null
                        || !sameMeshBinding(previous.binding(), request.binding())) throw invalid();
                verifySameRig(
                        storage.readMesh(previousKey),
                        previous.binding().rigSha256(),
                        storage.readMesh(targetKey),
                        request.binding().rigSha256());
            }
            String approval =
                    nose.validateForGeneration(model.getMeshObjectKey(), targetKey, request);
            EyeApprovalRequest eyeApproval = verifyEyeApproval(model, request.binding(), targetKey);

            List<Simulation> active =
                    simulations.findAllByFaceModelIdAndDeletedAtIsNullOrderById(modelId);
            Map<String, Integer> versions = versions(active);
            Set<MorphState> states = new HashSet<>();
            for (Simulation simulation : active) {
                states.add(codec.read(simulation.getMorphState()));
                history.findBySimulationId(simulation.getId())
                        .forEach(change -> states.add(codec.read(change.getStateAfter())));
            }
            nose.verifySavedNoseStates(model.getMeshObjectKey(), targetKey, approval, states);

            transactions.executeWithoutResult(
                    status -> {
                        FaceModel current =
                                models.findOwnedForUpdate(modelId, model.getUserId())
                                        .orElseThrow(ExistingNoseRigService::invalid);
                        if (!matches(model, current)) throw invalid();
                        List<Simulation> locked =
                                simulations.findActiveModelSimulationsForUpdate(modelId);
                        if (!versions.equals(versions(locked))) throw invalid();
                        String sourceKey = current.getSourceRigObjectKey();
                        if (sourceKey != null && !Objects.equals(sourceKey, previousKey)) {
                            deletionLog.save(
                                    DataDeletionLog.pending(
                                            current.getUserId(),
                                            DataDeletionLog.TARGET_RECON_OUTPUT,
                                            modelId,
                                            previousKey,
                                            "NOSE_RIG_REPLACED"));
                        }
                        current.upgradeNoseRig(targetKey, approval, null);
                        if (eyeApproval != null
                                && !eyes.approveForGeneration(modelId, eyeApproval)) {
                            throw invalid();
                        }
                        locked.forEach(Simulation::invalidateEditorVersion);
                    });
        } catch (BusinessException e) {
            throw e;
        } catch (RuntimeException e) {
            // S3 오류와 개인 리그 내용은 응답에 싣지 않는다.
            throw invalid();
        }
    }

    static String candidateKey(String previousKey, String hash) {
        return previousKey.substring(0, previousKey.lastIndexOf('/') + 1)
                + "rig-nose-013-"
                + hash
                + ".json";
    }

    private NoseEditService.Approval readApproval(FaceModel model) {
        String approval = model.getApprovedNoseCapabilities();
        return approval == null ? null : json.readValue(approval, NoseEditService.Approval.class);
    }

    private static boolean sameMeshBinding(
            NoseEditValidation.Binding before, NoseApprovalRequest.Binding after) {
        return Objects.equals(before.meshSha256(), after.meshSha256())
                && Objects.equals(before.fitSha(), after.fitSha())
                && Objects.equals(before.rigVersion(), after.rigVersion())
                && Objects.equals(before.topologyVersion(), after.topologyVersion());
    }

    void verifySameRig(byte[] before, String beforeHash, byte[] after, String afterHash) {
        if (!sha256(before).equals(beforeHash) || !sha256(after).equals(afterHash)) throw invalid();
        var original = json.readTree(before);
        var next = json.readTree(after);
        if (!(original.path("nose") instanceof ObjectNode oldNose)
                || !NEW_ENGINE.equals(next.path("nose").path("engine").asString())) throw invalid();
        boolean engineUpgrade = LEGACY_ENGINE.equals(oldNose.path("engine").asString());
        if (!engineUpgrade && !NEW_ENGINE.equals(oldNose.path("engine").asString()))
            throw invalid();
        if (engineUpgrade) oldNose.put("engine", NEW_ENGINE);
        var previousLimit = oldNose.path("limits").path("dorsum_height");
        var nextLimit = next.path("nose").path("limits").path("dorsum_height");
        if (!previousLimit.equals(nextLimit)) {
            if (!(previousLimit instanceof ArrayNode oldLimit)
                    || oldLimit.size() != 2
                    || !nextLimit.isArray()
                    || nextLimit.size() != 2) throw invalid();
            for (int bound = 0; bound < 2; bound++) {
                var beforeValue = oldLimit.get(bound);
                var afterValue = nextLimit.get(bound);
                if (beforeValue.equals(afterValue)) continue;
                if (!beforeValue.isNumber() || !afterValue.isNumber()) throw invalid();
                int direction = bound == 0 ? -1 : 1;
                double beforeMagnitude = direction * beforeValue.asDouble();
                double afterMagnitude = direction * afterValue.asDouble();
                if (!Double.isFinite(beforeMagnitude)
                        || !Double.isFinite(afterMagnitude)
                        || afterMagnitude <= 0
                        || afterMagnitude >= beforeMagnitude) throw invalid();
                oldLimit.set(bound, afterValue);
            }
        } else if (!engineUpgrade) {
            throw invalid();
        }
        if (!original.equals(next)) throw invalid();
    }

    private EyeApprovalRequest verifyEyeApproval(
            FaceModel model, NoseApprovalRequest.Binding binding, String targetKey) {
        if (model.getApprovedEyeCapabilities() == null) return null;
        var support = eyes.support(model.getId());
        var approved = support.capabilities();
        EyeReview review = support.review();
        if (approved == null || review == null) throw invalid();
        var eye =
                new EyeApprovalRequest(
                        approved.schemaVersion(),
                        new EyeApprovalRequest.Binding(
                                binding.meshSha256(),
                                binding.rigSha256(),
                                approved.eyePartsSha256(),
                                binding.engine(),
                                binding.rigVersion(),
                                binding.topologyVersion()),
                        approved.limits());
        if (!eyes.verifyAssets(
                model.getMeshObjectKey(), targetKey, Map.of("L", review.L(), "R", review.R()), eye))
            throw invalid();
        return eye;
    }

    private static Map<String, Integer> versions(List<Simulation> states) {
        return states.stream()
                .collect(Collectors.toMap(Simulation::getId, Simulation::getStateVersion));
    }

    private static boolean matches(FaceModel before, FaceModel after) {
        return !after.isDeleted()
                && Objects.equals(before.getSourceRigObjectKey(), after.getSourceRigObjectKey())
                && Objects.equals(before.getMeshObjectKey(), after.getMeshObjectKey())
                && Objects.equals(before.getRigObjectKey(), after.getRigObjectKey())
                && Objects.equals(before.getMorphSchemaVersion(), after.getMorphSchemaVersion())
                && Objects.equals(
                        before.getApprovedNoseCapabilities(), after.getApprovedNoseCapabilities())
                && Objects.equals(
                        before.getApprovedEyeCapabilities(), after.getApprovedEyeCapabilities())
                && Objects.equals(before.getEyeReview(), after.getEyeReview())
                && Objects.equals(before.getEyePartsSha256(), after.getEyePartsSha256());
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static BusinessException invalid() {
        return new BusinessException(EditErrorCode.NOSE_EDIT_NOT_READY);
    }
}
