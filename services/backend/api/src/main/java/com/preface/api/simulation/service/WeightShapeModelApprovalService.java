package com.preface.api.simulation.service;

import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.reconstruction.service.WeightShapeModelApproval;
import com.preface.common.facemodel.entity.FaceModel;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** Approves a baked weight-shape pair; legacy backfills additionally prove old GLB preservation. */
@Service
@RequiredArgsConstructor
public class WeightShapeModelApprovalService implements WeightShapeModelApproval {
    private static final int MAX_JSON_BYTES = 8 * 1024 * 1024;
    private static final int GLB_MAGIC = 0x46546c67;
    private static final int JSON_CHUNK = 0x4e4f534a;
    private static final String CODE = "contour.weight_shape";
    static final Set<String> CONTOUR_CODES =
            Set.of(
                    "contour.cheekbone",
                    "contour.cheek_volume",
                    "contour.chin_projection",
                    "contour.chin_length",
                    "contour.chin_width",
                    "contour.jaw_angle");

    private final ReconstructionStorage storage;
    private final JsonMapper json;
    private final ConcurrentHashMap<String, Set<String>> contourCache = new ConcurrentHashMap<>();

    public record Approval(
            int version,
            String meshSha256,
            String fitSha,
            int modelVersion,
            double negativeLimit,
            double positiveLimit,
            String meshObjectKey) {}

    record MeshBinding(String sha256, String fitSha) {}

    MeshBinding contourMeshBinding(FaceModel model) throws Exception {
        byte[] bytes = storage.readMesh(model.getMeshObjectKey());
        var asset = parseGlb(bytes).json().path("asset").path("extras").path("live-mirror");
        return new MeshBinding(sha256(bytes), asset.path("fit_sha").asText(""));
    }

    /** 현재 모델 GLB의 양방향 윤곽 타깃을 확인한다. S3 실패는 잠그고 다음 요청에서 재시도한다. */
    public Set<String> supportedContourCodes(FaceModel model) {
        if (model == null || model.isDeleted() || !"GLB".equals(model.getMeshFormat()))
            return Set.of();
        try {
            Approval approval =
                    model.getApprovedWeightShape() == null
                            ? null
                            : json.readValue(model.getApprovedWeightShape(), Approval.class);
            if (approval != null
                    && (approval.meshSha256() == null
                            || !approval.meshSha256().matches("[a-f0-9]{64}")
                            || (approval.meshObjectKey() == null
                                    ? model.getSourceMeshObjectKey() != null
                                    : !approval.meshObjectKey().equals(model.getMeshObjectKey()))))
                return Set.of();
            if (approval != null) {
                if (model.getApprovedNoseCapabilities() != null) {
                    NoseEditService.Approval nose =
                            json.readValue(
                                    model.getApprovedNoseCapabilities(),
                                    NoseEditService.Approval.class);
                    if (nose.binding() == null
                            || !approval.meshSha256().equals(nose.binding().meshSha256())
                            || !approval.fitSha().equals(nose.binding().fitSha())
                            || !model.getMorphSchemaVersion().equals(nose.schemaVersion()))
                        return Set.of();
                }
                Set<String> cached = contourCache.get(approval.meshSha256());
                if (cached != null) return cached;
            }
            byte[] bytes = storage.readMesh(model.getMeshObjectKey());
            String sha = sha256(bytes);
            if (approval != null && !approval.meshSha256().equals(sha)) return Set.of();
            Glb glb = parseGlb(bytes);
            JsonNode asset = glb.json().path("asset").path("extras").path("live-mirror");
            String fit = asset.path("fit_sha").asText("");
            if (!"live-mirror-head".equals(asset.path("name").asText())
                    || asset.path("version").asInt(-1) != 1
                    || !fit.matches("[a-f0-9]{12}")) return Set.of();
            if (approval != null && !approval.equals(candidate(glb, sha, approval.meshObjectKey())))
                return Set.of();
            if (model.getApprovedNoseCapabilities() != null) {
                NoseEditService.Approval nose =
                        json.readValue(
                                model.getApprovedNoseCapabilities(),
                                NoseEditService.Approval.class);
                if (nose.binding() == null
                        || !sha.equals(nose.binding().meshSha256())
                        || !fit.equals(nose.binding().fitSha())
                        || !model.getMorphSchemaVersion().equals(nose.schemaVersion()))
                    return Set.of();
            }
            Set<String> cached = contourCache.get(sha);
            if (cached != null) return cached;
            JsonNode measured = asset.path("contour_morphs").path("measured_limits");
            Set<String> supported =
                    CONTOUR_CODES.stream()
                            .filter(code -> hasTargetPair(glb, code))
                            .filter(
                                    code ->
                                            measured.isMissingNode()
                                                    || (validLimit(
                                                                    measured.path(code)
                                                                            .path("negative")
                                                                            .asDouble(Double.NaN))
                                                            && validLimit(
                                                                    measured.path(code)
                                                                            .path("positive")
                                                                            .asDouble(Double.NaN))))
                            .collect(java.util.stream.Collectors.toUnmodifiableSet());
            Set<String> previous = contourCache.putIfAbsent(sha, supported);
            return previous == null ? supported : previous;
        } catch (Exception e) {
            return Set.of();
        }
    }

    @Override
    public String validateForGeneration(String meshObjectKey, String noseApprovalJson) {
        try {
            byte[] bytes = storage.readMesh(meshObjectKey);
            String sha = sha256(bytes);
            Approval approval = candidate(parseGlb(bytes), sha, meshObjectKey);
            if (approval == null) return null;
            if (noseApprovalJson != null) {
                NoseEditService.Approval nose =
                        json.readValue(noseApprovalJson, NoseEditService.Approval.class);
                if (nose.binding() == null
                        || !sha.equals(nose.binding().meshSha256())
                        || !approval.fitSha().equals(nose.binding().fitSha())) return null;
            }
            return json.writeValueAsString(approval);
        } catch (Exception e) {
            // Missing assets, malformed GLBs and storage failures all leave this optional edit
            // locked.
            return null;
        }
    }

    /** S3의 옛·새 GLB를 직접 읽고 기존 바이트·타깃 보존을 확인한다. 코 승인이 없던 모델도 지원한다. */
    public String validateForBackfill(
            String oldKey, String newKey, String oldSha256, String newSha256) {
        try {
            if (oldKey == null
                    || newKey == null
                    || oldKey.equals(newKey)
                    || oldSha256 == null
                    || !oldSha256.matches("[a-f0-9]{64}")
                    || newSha256 == null
                    || !newSha256.matches("[a-f0-9]{64}")) return null;
            byte[] beforeBytes = storage.readMesh(oldKey);
            byte[] afterBytes = storage.readMesh(newKey);
            if (!oldSha256.equals(sha256(beforeBytes)) || !newSha256.equals(sha256(afterBytes)))
                return null;
            Glb before = parseGlb(beforeBytes), after = parseGlb(afterBytes);
            Approval candidate = candidate(after, newSha256, newKey);
            return candidate != null && preserved(before, after)
                    ? json.writeValueAsString(candidate)
                    : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    Set<String> addedContourPairs(String oldKey, String newKey, String oldSha, String newSha)
            throws Exception {
        byte[] oldBytes = storage.readMesh(oldKey), newBytes = storage.readMesh(newKey);
        if (!oldSha.equals(sha256(oldBytes)) || !newSha.equals(sha256(newBytes))) return Set.of();
        Glb before = parseGlb(oldBytes), after = parseGlb(newBytes);
        ObjectNode oldJson = (ObjectNode) before.json();
        ObjectNode newJson = ((ObjectNode) after.json()).deepCopy();
        ByteBuffer original = before.binary().duplicate(), candidate = after.binary().duplicate();
        if (original.remaining() > candidate.remaining()) return Set.of();
        candidate.limit(original.remaining());
        if (!original.equals(candidate)
                || !prefix(oldJson.path("accessors"), newJson.path("accessors"))
                || !prefix(oldJson.path("bufferViews"), newJson.path("bufferViews")))
            return Set.of();

        var oldModel = (ObjectNode) oldJson.at("/asset/extras/live-mirror");
        var newModel = (ObjectNode) newJson.at("/asset/extras/live-mirror");
        if (oldModel.has("contour_morphs")) return Set.of();
        JsonNode measured = newModel.remove("contour_morphs");
        if (measured == null
                || measured.path("version").asInt() != 1
                || !measured.path("codes").isArray()) return Set.of();
        JsonNode limits = measured.path("measured_limits");
        var codes = new java.util.LinkedHashSet<String>();
        var names = new java.util.ArrayList<String>();
        for (JsonNode codeNode : measured.path("codes")) {
            String code = codeNode.asText();
            if (!CONTOUR_CODES.contains(code)
                    || !codes.add(code)
                    || !validLimit(limits.path(code).path("negative").asDouble(Double.NaN))
                    || !validLimit(limits.path(code).path("positive").asDouble(Double.NaN))
                    || !hasTargetPair(after, code)
                    || hasTargetPair(before, code)) return Set.of();
            names.add(code + "_neg");
            names.add(code + "_pos");
        }
        if (codes.isEmpty() || limits.size() != codes.size()) return Set.of();

        for (int i = 0; i < oldJson.path("meshes").size(); i++) {
            var oldSkin = oldJson.path("meshes").path(i);
            if (!"skin".equals(oldSkin.path("name").asText())) continue;
            var newSkin = newJson.path("meshes").path(i);
            var oldPrimitive = oldSkin.at("/primitives/0");
            var newPrimitive = (ObjectNode) newSkin.at("/primitives/0");
            JsonNode oldTargets = oldPrimitive.path("targets"),
                    newTargets = newPrimitive.path("targets");
            if (oldSkin.path("primitives").size() != 1
                    || !prefix(oldTargets, newTargets)
                    || newTargets.size() != oldTargets.size() + names.size()
                    || !stripTail(
                            (ObjectNode) newSkin.path("extras"),
                            "targetNames",
                            oldSkin.at("/extras/targetNames"),
                            names)
                    || !stripTail(
                            (ObjectNode) newSkin,
                            "weights",
                            oldSkin.path("weights"),
                            java.util.Collections.nCopies(names.size(), 0))) return Set.of();
            newPrimitive.set("targets", oldTargets);
        }
        for (String name : java.util.List.of("morph_targets", "default_weights")) {
            if (oldModel.has(name)
                    && !stripTail(
                            newModel,
                            name,
                            oldModel.path(name),
                            "morph_targets".equals(name)
                                    ? names
                                    : java.util.Collections.nCopies(names.size(), 0)))
                return Set.of();
        }
        newJson.set("accessors", oldJson.path("accessors"));
        newJson.set("bufferViews", oldJson.path("bufferViews"));
        ((ObjectNode) newJson.at("/buffers/0"))
                .set("byteLength", oldJson.at("/buffers/0/byteLength"));
        return oldJson.equals(newJson) ? codes : Set.of();
    }

    private static boolean stripTail(
            ObjectNode node, String field, JsonNode before, java.util.List<?> tail) {
        JsonNode values = node.path(field);
        if (!prefix(before, values) || values.size() != before.size() + tail.size()) return false;
        for (int i = 0; i < tail.size(); i++) {
            JsonNode added = values.path(before.size() + i);
            if (tail.get(i) instanceof String name
                    ? !name.equals(added.asText())
                    : !added.isNumber() || added.asDouble() != 0) return false;
        }
        if (before.isMissingNode()) node.remove(field);
        else node.set(field, before);
        return true;
    }

    /** 기존 GLB에서 광대 타깃의 accessor 참조만 바뀌었는지 확인한다. */
    boolean cheekboneRepairPreservesAssets(
            String oldKey, String newKey, String oldSha, String newSha) {
        try {
            byte[] oldBytes = storage.readMesh(oldKey), newBytes = storage.readMesh(newKey);
            if (!oldSha.equals(sha256(oldBytes)) || !newSha.equals(sha256(newBytes))) return false;
            Glb before = parseGlb(oldBytes), after = parseGlb(newBytes);
            if (!hasTargetPair(after, "contour.cheekbone")) return false;
            var oldJson = (ObjectNode) before.json();
            var newJson = (ObjectNode) after.json();
            ByteBuffer original = before.binary().duplicate(),
                    repaired = after.binary().duplicate();
            if (original.remaining() > repaired.remaining()) return false;
            repaired.limit(original.remaining());
            if (!original.equals(repaired)
                    || !prefix(oldJson.path("accessors"), newJson.path("accessors"))
                    || !prefix(oldJson.path("bufferViews"), newJson.path("bufferViews")))
                return false;
            int oldAccessors = oldJson.path("accessors").size();
            JsonNode skins = newJson.path("meshes"), oldSkins = oldJson.path("meshes");
            int replaced = 0;
            for (int m = 0; m < skins.size(); m++) {
                JsonNode skin = skins.path(m);
                if (!"skin".equals(skin.path("name").asText())) continue;
                var targets = (ArrayNode) skin.path("primitives").path(0).path("targets");
                JsonNode names = skin.path("extras").path("targetNames");
                for (int i = 0; i < names.size(); i++) {
                    String name = names.path(i).asText();
                    if (!"contour.cheekbone_neg".equals(name)
                            && !"contour.cheekbone_pos".equals(name)) continue;
                    if (targets.path(i).path("POSITION").asInt(-1) < oldAccessors
                            || targets.path(i).path("NORMAL").asInt(-1) < oldAccessors)
                        return false;
                    targets.set(
                            i, oldSkins.path(m).path("primitives").path(0).path("targets").path(i));
                    replaced++;
                }
            }
            newJson.set("accessors", oldJson.path("accessors"));
            newJson.set("bufferViews", oldJson.path("bufferViews"));
            ((ObjectNode) newJson.path("buffers").path(0))
                    .set("byteLength", oldJson.path("buffers").path(0).path("byteLength"));
            return replaced == 2 && oldJson.equals(newJson);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static Approval candidate(Glb glb, String sha, String key) {
        JsonNode model = glb.json().path("asset").path("extras").path("live-mirror");
        JsonNode shape = model.path("weight_shape");
        String fit = model.path("fit_sha").asText("");
        int version = model.path("version").asInt(-1);
        double negativeLimit = shape.path("negative_limit").asDouble(Double.NaN);
        double positiveLimit = shape.path("positive_limit").asDouble(Double.NaN);
        if (!"live-mirror-head".equals(model.path("name").asText())
                || version != 1
                || !fit.matches("[a-f0-9]{12}")
                || !fit.equals(shape.path("fit_sha").asText())
                || shape.path("version").asInt(-1) != 1
                || !CODE.equals(shape.path("code").asText())
                || shape.path("model_version").asInt(-1) != version
                || !validLimit(negativeLimit)
                || !validLimit(positiveLimit)
                || !hasTargetPair(glb, CODE)) return null;
        return new Approval(1, sha, fit, version, negativeLimit, positiveLimit, key);
    }

    private static boolean prefix(JsonNode before, JsonNode after) {
        if (before.isMissingNode()) return after.isArray();
        if (!before.isArray() || !after.isArray() || before.size() > after.size()) return false;
        for (int i = 0; i < before.size(); i++)
            if (!before.path(i).equals(after.path(i))) return false;
        return true;
    }

    private static boolean preserved(Glb before, Glb after) {
        JsonNode oldJson = before.json(), newJson = after.json();
        if (!prefix(oldJson.path("accessors"), newJson.path("accessors"))
                || !prefix(oldJson.path("bufferViews"), newJson.path("bufferViews"))
                || !oldJson.path("materials").equals(newJson.path("materials"))
                || !oldJson.path("textures").equals(newJson.path("textures"))
                || !oldJson.path("images").equals(newJson.path("images"))
                || !oldJson.path("samplers").equals(newJson.path("samplers"))
                || !oldJson.path("nodes").equals(newJson.path("nodes"))
                || !oldJson.path("scenes").equals(newJson.path("scenes"))) return false;
        ByteBuffer oldBinary = before.binary().duplicate(), newBinary = after.binary().duplicate();
        if (oldBinary.remaining() > newBinary.remaining()) return false;
        newBinary.limit(oldBinary.remaining());
        if (!oldBinary.equals(newBinary)) return false;
        JsonNode oldModel = oldJson.path("asset").path("extras").path("live-mirror");
        JsonNode newModel = newJson.path("asset").path("extras").path("live-mirror");
        if (!oldModel.path("weight_shape").isMissingNode()
                || newModel.size() != oldModel.size() + 1) return false;
        for (var field : oldModel.properties()) {
            if (!field.getValue().equals(newModel.path(field.getKey()))) return false;
        }
        JsonNode oldMeshes = oldJson.path("meshes"), newMeshes = newJson.path("meshes");
        if (!oldMeshes.isArray() || !newMeshes.isArray() || oldMeshes.size() != newMeshes.size())
            return false;
        for (int i = 0; i < oldMeshes.size(); i++) {
            JsonNode oldMesh = oldMeshes.path(i), newMesh = newMeshes.path(i);
            if (!"skin".equals(oldMesh.path("name").asText())) {
                if (!oldMesh.equals(newMesh)) return false;
                continue;
            }
            JsonNode oldPrimitives = oldMesh.path("primitives"),
                    newPrimitives = newMesh.path("primitives");
            if (oldPrimitives.size() != 1 || newPrimitives.size() != 1) return false;
            JsonNode oldPrimitive = oldPrimitives.path(0), newPrimitive = newPrimitives.path(0);
            JsonNode oldNames = oldMesh.path("extras").path("targetNames");
            JsonNode newNames = newMesh.path("extras").path("targetNames");
            JsonNode oldTargets = oldPrimitive.path("targets"),
                    newTargets = newPrimitive.path("targets");
            JsonNode oldWeights = oldMesh.path("weights"), newWeights = newMesh.path("weights");
            if (!oldPrimitive.path("attributes").equals(newPrimitive.path("attributes"))
                    || !oldPrimitive.path("indices").equals(newPrimitive.path("indices"))
                    || !oldPrimitive.path("material").equals(newPrimitive.path("material"))
                    || !prefix(oldNames, newNames)
                    || !prefix(oldTargets, newTargets)
                    || !prefix(oldWeights, newWeights)
                    || newNames.size() != oldNames.size() + 2
                    || newTargets.size() != oldTargets.size() + 2
                    || newWeights.size() != oldNames.size() + 2
                    || (oldWeights.isMissingNode()
                            && java.util.stream.IntStream.range(0, oldNames.size())
                                    .anyMatch(
                                            index ->
                                                    newWeights.path(index).asDouble(Double.NaN)
                                                            != 0))
                    || newWeights.path(newWeights.size() - 1).asDouble(Double.NaN) != 0
                    || newWeights.path(newWeights.size() - 2).asDouble(Double.NaN) != 0
                    || !CODE.concat("_neg").equals(newNames.path(oldNames.size()).asText())
                    || !CODE.concat("_pos").equals(newNames.path(oldNames.size() + 1).asText()))
                return false;
        }
        return true;
    }

    private static boolean validLimit(double limit) {
        return Double.isFinite(limit) && limit > 0 && limit <= 1;
    }

    private record Glb(JsonNode json, ByteBuffer binary) {}

    private Glb parseGlb(byte[] bytes) {
        if (bytes == null || bytes.length < 28) throw new IllegalArgumentException("invalid GLB");
        ByteBuffer header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        int length = header.getInt(8), jsonLength = header.getInt(12);
        if (header.getInt(0) != GLB_MAGIC
                || header.getInt(4) != 2
                || length != bytes.length
                || jsonLength <= 0
                || jsonLength > MAX_JSON_BYTES
                || header.getInt(16) != JSON_CHUNK
                || 28L + jsonLength > bytes.length) {
            throw new IllegalArgumentException("invalid GLB header");
        }
        int binaryLength = header.getInt(20 + jsonLength);
        int binaryStart = 28 + jsonLength;
        if (binaryLength < 0
                || header.getInt(24 + jsonLength) != 0x004e4942
                || (long) binaryStart + binaryLength != bytes.length) {
            throw new IllegalArgumentException("invalid GLB binary");
        }
        JsonNode document =
                json.readTree(new String(bytes, 20, jsonLength, StandardCharsets.UTF_8));
        return new Glb(
                document,
                ByteBuffer.wrap(bytes, binaryStart, binaryLength)
                        .slice()
                        .order(ByteOrder.LITTLE_ENDIAN));
    }

    private static boolean hasTargetPair(Glb glb, String code) {
        JsonNode accessors = glb.json().path("accessors");
        JsonNode views = glb.json().path("bufferViews");
        for (JsonNode mesh : glb.json().path("meshes")) {
            if (!"skin".equals(mesh.path("name").asText())) continue;
            JsonNode names = mesh.path("extras").path("targetNames");
            JsonNode primitive = mesh.path("primitives").path(0);
            JsonNode targets = primitive.path("targets");
            int baseAccessor = primitive.path("attributes").path("POSITION").asInt(-1);
            int baseCount = accessorCount(accessors, baseAccessor);
            if (baseCount <= 0
                    || !names.isArray()
                    || !targets.isArray()
                    || names.size() != targets.size()) return false;
            return targetPresent(
                            names,
                            targets,
                            accessors,
                            views,
                            glb.binary(),
                            code + "_neg",
                            baseCount)
                    && targetPresent(
                            names,
                            targets,
                            accessors,
                            views,
                            glb.binary(),
                            code + "_pos",
                            baseCount);
        }
        return false;
    }

    private static boolean targetPresent(
            JsonNode names,
            JsonNode targets,
            JsonNode accessors,
            JsonNode views,
            ByteBuffer binary,
            String code,
            int baseCount) {
        int count = 0;
        for (int i = 0; i < names.size(); i++) {
            if (!code.equals(names.path(i).asText())) continue;
            JsonNode accessor = accessors.path(targets.path(i).path("POSITION").asInt(-1));
            JsonNode sparse = accessor.path("sparse");
            int sparseCount = sparse.path("count").asInt(0);
            if (!"VEC3".equals(accessor.path("type").asText())
                    || accessor.path("componentType").asInt(-1) != 5126
                    || accessor.path("count").asInt(-1) != baseCount
                    || accessor.has("bufferView")
                    || sparseCount <= 0
                    || sparseCount > baseCount
                    || sparse.path("indices").path("componentType").asInt(-1) != 5125) return false;
            int indices =
                    viewOffset(
                            views, sparse.path("indices"), binary.limit(), (long) sparseCount * 4);
            int values =
                    viewOffset(
                            views, sparse.path("values"), binary.limit(), (long) sparseCount * 12);
            if (indices < 0 || values < 0) return false;
            boolean moved = false;
            int last = -1;
            for (int j = 0; j < sparseCount; j++) {
                long index = Integer.toUnsignedLong(binary.getInt(indices + 4 * j));
                if (index <= last || index >= baseCount) return false;
                last = (int) index;
                for (int axis = 0; axis < 3; axis++) {
                    float displacement = binary.getFloat(values + 12 * j + axis * 4);
                    if (!Float.isFinite(displacement)) return false;
                    moved |= displacement != 0;
                }
            }
            if (!moved) return false;
            count++;
        }
        return count == 1;
    }

    private static int viewOffset(
            JsonNode views, JsonNode sparse, int binaryLength, long required) {
        JsonNode view = views.path(sparse.path("bufferView").asInt(-1));
        long viewStart = view.path("byteOffset").asLong(0);
        long length = view.path("byteLength").asLong(-1);
        long inner = sparse.path("byteOffset").asLong(0);
        long start = viewStart + inner;
        if (view.path("buffer").asInt(-1) != 0
                || viewStart < 0
                || start < 0
                || inner < 0
                || length < 0
                || required > length
                || required > binaryLength
                || inner > length - required
                || start > binaryLength - required) return -1;
        return (int) start;
    }

    private static int accessorCount(JsonNode accessors, int index) {
        JsonNode accessor = accessors.path(index);
        return "VEC3".equals(accessor.path("type").asText())
                        && accessor.path("componentType").asInt(-1) == 5126
                ? accessor.path("count").asInt(-1)
                : -1;
    }
}
