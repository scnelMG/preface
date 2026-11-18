package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.common.facemodel.entity.FaceModel;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class WeightShapeModelApprovalServiceTest {
    private static final String FIT = "c".repeat(12);
    private static final String OTHER_FIT = "d".repeat(12);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private final JsonMapper json = JsonMapper.builder().build();
    private final WeightShapeModelApprovalService service =
            new WeightShapeModelApprovalService(storage, json);

    @Test
    void 생성_원본과_승인_해시가_같고_안전한_타깃_쌍이_있을_때만_체중_방향을_승인한다() throws Exception {
        byte[] mesh = glb(FIT, 1, true);
        when(storage.readMesh("synthetic.glb")).thenReturn(mesh);

        String approved = service.validateForGeneration("synthetic.glb", nose(mesh, FIT));

        WeightShapeModelApprovalService.Approval result =
                json.readValue(approved, WeightShapeModelApprovalService.Approval.class);
        assertThat(result.version()).isEqualTo(1);
        assertThat(result.meshSha256()).isEqualTo(sha(mesh));
        assertThat(result.fitSha()).isEqualTo(FIT);
        assertThat(result.negativeLimit()).isEqualTo(0.5);
        assertThat(result.positiveLimit()).isEqualTo(1);
    }

    @Test
    void 코_승인_없이도_실제_GLB에_결속된_체중_타깃을_승인한다() throws Exception {
        byte[] mesh = glb(FIT, 1, true);
        when(storage.readMesh("synthetic.glb")).thenReturn(mesh);
        String approved = service.validateForGeneration("synthetic.glb", null);
        var proof = json.readValue(approved, WeightShapeModelApprovalService.Approval.class);
        assertThat(proof.meshObjectKey()).isEqualTo("synthetic.glb");
        assertThat(proof.meshSha256()).isEqualTo(sha(mesh));
        var models = mock(com.preface.common.facemodel.repository.FaceModelRepository.class);
        var model =
                FaceModel.create(
                        "user", "job", "synthetic.glb", null, null, null, null, "GLB", "v1", null);
        model.approveWeightShape(approved);
        when(models.findById("model")).thenReturn(java.util.Optional.of(model));
        assertThat(new WeightShapeEditGuard(models, json).supported("model")).isTrue();
    }

    @Test
    void 승인된_GLB에_실제_윤곽_타깃_쌍이_있을_때만_채팅_코드를_연다() throws Exception {
        byte[] mesh = glb(FIT, 1, true, false, true);
        when(storage.readMesh("synthetic.glb")).thenReturn(mesh);
        FaceModel model =
                FaceModel.create(
                        "user", "job", "synthetic.glb", null, null, null, null, "GLB", "v1", null);
        model.approveWeightShape(service.validateForGeneration("synthetic.glb", nose(mesh, FIT)));

        when(storage.readMesh("synthetic.glb")).thenReturn(glb(FIT, 1, true));
        assertThat(service.supportedContourCodes(model)).isEmpty();
        when(storage.readMesh("synthetic.glb")).thenReturn(mesh);
        assertThat(service.supportedContourCodes(model)).containsExactly("contour.cheekbone");

        byte[] weightOnly = glb(FIT, 1, true);
        FaceModel noContour =
                FaceModel.create(
                        "user", "job", "weight.glb", null, null, null, null, "GLB", "v1", null);
        when(storage.readMesh("weight.glb")).thenReturn(weightOnly);
        noContour.approveWeightShape(
                service.validateForGeneration("weight.glb", nose(weightOnly, FIT)));
        assertThat(service.supportedContourCodes(noContour)).isEmpty();
    }

    @Test
    void 체중_승인이_없어도_현재_GLB의_윤곽_타깃_쌍만_채팅에_연다() throws Exception {
        byte[] withContour = glb(FIT, 1, true, false, true);
        FaceModel model =
                FaceModel.create(
                        "user", "job", "synthetic.glb", null, null, null, null, "GLB", "v1", null);
        when(storage.readMesh("synthetic.glb")).thenReturn(withContour);
        assertThat(service.supportedContourCodes(model)).containsExactly("contour.cheekbone");

        model.approveNose(nose(withContour, FIT));
        assertThat(service.supportedContourCodes(model)).containsExactly("contour.cheekbone");
        model.approveNose(nose(glb(OTHER_FIT, 1, true), OTHER_FIT));
        assertThat(service.supportedContourCodes(model)).isEmpty();

        model.approveNose(nose(withContour, FIT));
        when(storage.readMesh("synthetic.glb")).thenReturn(glb(FIT, 1, true));
        assertThat(service.supportedContourCodes(model)).isEmpty();
        when(storage.readMesh("synthetic.glb")).thenReturn(new byte[0]);
        assertThat(service.supportedContourCodes(model)).isEmpty();
    }

    @Test
    void 모델_결속이나_타깃이_틀리면_생성은_막지_않고_체중_편집만_잠근다() throws Exception {
        byte[] mesh = glb(FIT, 1, true);
        when(storage.readMesh("synthetic.glb")).thenReturn(mesh);
        assertThat(service.validateForGeneration("synthetic.glb", nose(mesh, OTHER_FIT))).isNull();
        assertThat(
                        service.validateForGeneration(
                                "synthetic.glb", nose(glb(OTHER_FIT, 1, true), FIT)))
                .isNull();
        byte[] missing = glb(FIT, 1, false);
        when(storage.readMesh("synthetic.glb")).thenReturn(missing);
        assertThat(service.validateForGeneration("synthetic.glb", nose(missing, FIT))).isNull();
        byte[] wrongVersion = glb(FIT, 2, true);
        when(storage.readMesh("synthetic.glb")).thenReturn(wrongVersion);
        assertThat(service.validateForGeneration("synthetic.glb", nose(wrongVersion, FIT)))
                .isNull();
    }

    @Test
    void 잘못된_GLB와_읽기_실패는_승인하지_않는다() throws Exception {
        when(storage.readMesh("synthetic.glb")).thenReturn(new byte[0]);
        assertThat(service.validateForGeneration("synthetic.glb", nose(glb(FIT, 1, true), FIT)))
                .isNull();
        when(storage.readMesh("synthetic.glb")).thenThrow(new IllegalStateException("synthetic"));
        assertThat(service.validateForGeneration("synthetic.glb", "{}")).isNull();
    }

    @Test
    void 희소_타깃의_실제_변위가_없거나_비유한이면_승인하지_않는다() throws Exception {
        byte[] zero = glb(FIT, 1, true);
        ByteBuffer.wrap(zero).order(ByteOrder.LITTLE_ENDIAN).putFloat(binaryStart(zero) + 20, 0);
        when(storage.readMesh("synthetic.glb")).thenReturn(zero);
        assertThat(service.validateForGeneration("synthetic.glb", nose(zero, FIT))).isNull();

        byte[] nonfinite = glb(FIT, 1, true);
        ByteBuffer.wrap(nonfinite)
                .order(ByteOrder.LITTLE_ENDIAN)
                .putFloat(binaryStart(nonfinite) + 20, Float.NaN);
        when(storage.readMesh("synthetic.glb")).thenReturn(nonfinite);
        assertThat(service.validateForGeneration("synthetic.glb", nose(nonfinite, FIT))).isNull();
    }

    @Test
    void 희소_인덱스와_버퍼_범위가_틀리면_승인하지_않는다() throws Exception {
        byte[] index = glb(FIT, 1, true);
        ByteBuffer.wrap(index).order(ByteOrder.LITTLE_ENDIAN).putInt(binaryStart(index) + 16, 3);
        when(storage.readMesh("synthetic.glb")).thenReturn(index);
        assertThat(service.validateForGeneration("synthetic.glb", nose(index, FIT))).isNull();

        byte[] outOfBounds = glb(FIT, 1, true, true);
        when(storage.readMesh("synthetic.glb")).thenReturn(outOfBounds);
        assertThat(service.validateForGeneration("synthetic.glb", nose(outOfBounds, FIT))).isNull();
    }

    @Test
    void 기존_GLB의_정점과_타깃을_보존한_새_GLB만_소급_승인한다() throws Exception {
        byte[] oldMesh = legacyGlb(FIT);
        byte[] newMesh = glb(FIT, 1, true);
        when(storage.readMesh("old.glb")).thenReturn(oldMesh);
        when(storage.readMesh("new.glb")).thenReturn(newMesh);
        String approved =
                service.validateForBackfill("old.glb", "new.glb", sha(oldMesh), sha(newMesh));
        WeightShapeModelApprovalService.Approval result =
                json.readValue(approved, WeightShapeModelApprovalService.Approval.class);
        assertThat(result.meshObjectKey()).isEqualTo("new.glb");
        assertThat(service.validateForBackfill("old.glb", "new.glb", "0".repeat(64), sha(newMesh)))
                .isNull();
        byte[] changedBase = legacyGlb(OTHER_FIT);
        when(storage.readMesh("old.glb")).thenReturn(changedBase);
        assertThat(
                        service.validateForBackfill(
                                "old.glb", "new.glb", sha(changedBase), sha(newMesh)))
                .isNull();
    }

    private String nose(byte[] mesh, String fit) throws Exception {
        return json.writeValueAsString(
                new NoseEditService.Approval(
                        "v1",
                        new NoseEditValidation.Binding(
                                sha(mesh), "b".repeat(64), fit, "engine", "v1", "topology"),
                        Map.of()));
    }

    @Test
    void 윤곽_추가는_기존_체중_타깃과_자산을_유지한_측정_후보만_허용한다() throws Exception {
        byte[] before = glb(FIT, 1, true);
        byte[] after = withMeasuredContour(false);
        when(storage.readMesh("old.glb")).thenReturn(before);
        when(storage.readMesh("new.glb")).thenReturn(after);
        assertThat(service.addedContourPairs("old.glb", "new.glb", sha(before), sha(after)))
                .containsExactly("contour.cheekbone");

        byte[] changedWeight = withMeasuredContour(true);
        when(storage.readMesh("new.glb")).thenReturn(changedWeight);
        assertThat(service.addedContourPairs("old.glb", "new.glb", sha(before), sha(changedWeight)))
                .isEmpty();
        assertThat(service.addedContourPairs("old.glb", "new.glb", sha(before), sha(after)))
                .isEmpty();
    }

    private static byte[] withMeasuredContour(boolean changeWeight) {
        byte[] mesh = glb(FIT, 1, true, false, true);
        int start = binaryStart(mesh);
        String doc = new String(mesh, 20, start - 28, StandardCharsets.UTF_8).stripTrailing();
        doc =
                doc.replace(
                        "\"weight_shape\":{",
                        """
                "contour_morphs":{"version":1,"codes":["contour.cheekbone"],
                "measured_limits":{"contour.cheekbone":{"negative":0.5,"positive":1}}},
                "weight_shape":{
                """);
        byte[] body = doc.getBytes(StandardCharsets.UTF_8);
        int padded = (body.length + 3) & ~3;
        ByteBuffer bytes = ByteBuffer.allocate(28 + padded + 32).order(ByteOrder.LITTLE_ENDIAN);
        bytes.putInt(0x46546c67).putInt(2).putInt(bytes.capacity());
        bytes.putInt(padded).putInt(0x4e4f534a).put(body);
        while (bytes.position() < 20 + padded) bytes.put((byte) ' ');
        bytes.putInt(32).putInt(0x004e4942).put(mesh, start, 32);
        if (changeWeight) bytes.putFloat(28 + padded + 4, -0.004f);
        return bytes.array();
    }

    private static String sha(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static byte[] glb(String fit, int modelVersion, boolean pair) {
        return glb(fit, modelVersion, pair, false);
    }

    private static byte[] glb(String fit, int modelVersion, boolean pair, boolean badView) {
        return glb(fit, modelVersion, pair, badView, false);
    }

    private static byte[] glb(
            String fit, int modelVersion, boolean pair, boolean badView, boolean contour) {
        String positive = pair ? ",\"contour.weight_shape_pos\"" : "";
        String target = pair ? ", {\"POSITION\":2}" : "";
        String contourNames = contour ? ",\"contour.cheekbone_neg\",\"contour.cheekbone_pos\"" : "";
        String contourTargets = contour ? ", {\"POSITION\":1}, {\"POSITION\":2}" : "";
        String contourWeights = contour ? ",0,0" : "";
        String positiveOffset = badView ? "9999" : "20";
        String json =
                ("""
                {"asset":{"extras":{"live-mirror":{"name":"live-mirror-head","version":%d,"fit_sha":"%s",
                "weight_shape":{"version":1,"code":"contour.weight_shape","fit_sha":"%s","model_version":1,
                "negative_limit":0.5,"positive_limit":1}}}},
                "buffers":[{"byteLength":32}],
                "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":4},
                {"buffer":0,"byteOffset":4,"byteLength":12},
                {"buffer":0,"byteOffset":16,"byteLength":4},
                {"buffer":0,"byteOffset":%s,"byteLength":12}],
                "accessors":[{"type":"VEC3","componentType":5126,"count":3},
                {"type":"VEC3","componentType":5126,"count":3,"sparse":{"count":1,
                  "indices":{"bufferView":0,"componentType":5125},"values":{"bufferView":1}}},
                {"type":"VEC3","componentType":5126,"count":3,"sparse":{"count":1,
                  "indices":{"bufferView":2,"componentType":5125},"values":{"bufferView":3}}}],
                "meshes":[{"name":"skin","weights":[0,0%s],"extras":{"targetNames":["contour.weight_shape_neg"%s%s]},
                "primitives":[{"attributes":{"POSITION":0},"targets":[{"POSITION":1}%s%s]}]}]}
                """)
                        .formatted(
                                modelVersion,
                                fit,
                                fit,
                                positiveOffset,
                                contourWeights,
                                positive,
                                contourNames,
                                target,
                                contourTargets);
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        int padded = (body.length + 3) & ~3;
        ByteBuffer bytes = ByteBuffer.allocate(20 + padded + 8 + 32).order(ByteOrder.LITTLE_ENDIAN);
        bytes.putInt(0x46546c67).putInt(2).putInt(bytes.capacity());
        bytes.putInt(padded).putInt(0x4e4f534a).put(body);
        while (bytes.position() < 20 + padded) bytes.put((byte) ' ');
        bytes.putInt(32).putInt(0x004e4942);
        bytes.putInt(1).putFloat(-0.003f).putFloat(0).putFloat(0);
        bytes.putInt(1).putFloat(0.003f).putFloat(0).putFloat(0);
        return bytes.array();
    }

    private static byte[] legacyGlb(String fit) {
        String document =
                ("""
                {"asset":{"extras":{"live-mirror":{"name":"live-mirror-head","version":1,"fit_sha":"%s"}}},
                "bufferViews":[],"accessors":[{"type":"VEC3","componentType":5126,"count":3}],
                "meshes":[{"name":"skin","primitives":[{"attributes":{"POSITION":0}}]}]}
                """)
                        .formatted(fit);
        byte[] body = document.getBytes(StandardCharsets.UTF_8);
        int padded = (body.length + 3) & ~3;
        ByteBuffer bytes = ByteBuffer.allocate(20 + padded + 8).order(ByteOrder.LITTLE_ENDIAN);
        bytes.putInt(0x46546c67).putInt(2).putInt(bytes.capacity());
        bytes.putInt(padded).putInt(0x4e4f534a).put(body);
        while (bytes.position() < 20 + padded) bytes.put((byte) ' ');
        bytes.putInt(0).putInt(0x004e4942);
        return bytes.array();
    }

    private static int binaryStart(byte[] bytes) {
        return 28 + ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).getInt(12);
    }
}
