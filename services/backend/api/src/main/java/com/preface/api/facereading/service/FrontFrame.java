package com.preface.api.facereading.service;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Comparator;
import java.util.Map;
import java.util.Optional;
import java.util.stream.StreamSupport;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 프레임 묶음에서 관상에 쓸 정면 프레임 1장을 골라 작게 줄인 JPEG로 만든다.
 *
 * <p>고르는 규칙: {@code prepare.json} images 중 얼굴이 있고({@code face}) 가짜 얼굴·마커가 아니며 yaw가 있는 것 가운데
 * <b>좌우(yaw)와 고개 상하(pitch)를 함께 본 각도 거리</b> √(yaw² + pitch²)가 가장 작은 것, 같으면 선명도({@code sharpness})가 큰
 * 것(S15P31B204-678). 좌우만 보면 고개를 든·숙인 프레임이 뽑혔다(원본 6건 11/08: chae01은 고개를 약 40° 든 프레임. 함께 보면 6건 모두 실제
 * 상하 7° 이내). GPU 워커의 5방향 사진 {@code FRONT}도 같은 규칙을 3D 복원(SfM) 각도로 쓴다({@code worker.py} {@code
 * sfm_captures}). 관상은 3D 완성 전에 돌기 때문에 MediaPipe 각도를 쓴다. 3D 실패와 달리 관상은 정면 허용 좌우 각도를 조금 넓게 둔다.
 */
final class FrontFrame {

    /** GPU 워커는 15°를 넘으면 3D를 실패시킨다. 관상은 풀이용이라 조금 더 돌아간 얼굴도 받는다. */
    static final double MAX_FRONT_YAW_DEG = 25.0;

    /** GMS로 보내는 긴 변. 얼굴 부위를 보기엔 충분하고 이미지 토큰·전송량을 줄인다. */
    static final int MAX_SIDE = 768;

    private static final float JPEG_QUALITY = 0.85f;

    private FrontFrame() {}

    /** 묶음 tar 스트림 → 줄인 정면 JPEG. */
    static byte[] fromBundle(InputStream tar, ObjectMapper mapper) throws IOException {
        Map<String, byte[]> files =
                BundleTar.read(
                        tar, name -> name.equals("prepare.json") || name.startsWith("images/"));
        byte[] prepare = files.get("prepare.json");
        if (prepare == null) {
            throw new FaceReadingFailure(FaceReadingFailure.BAD_BUNDLE, "prepare.json missing");
        }
        String file = pick(mapper.readTree(prepare));
        byte[] image = files.get("images/" + file);
        if (image == null) {
            throw new FaceReadingFailure(FaceReadingFailure.BAD_BUNDLE, "front image missing");
        }
        return shrink(image);
    }

    /** 정면에서 떨어진 각도(도): √(yaw² + pitch²). pitch가 없으면 0으로 본다. */
    static double angleFromFront(JsonNode image) {
        return Math.hypot(image.path("yaw").asDouble(), image.path("pitch").asDouble(0.0));
    }

    /** prepare.json에서 정면 프레임 파일 이름(images/ 아래). 없으면 {@code NO_FRONT}. */
    static String pick(JsonNode prepare) {
        JsonNode images = prepare.path("images");
        Optional<JsonNode> best =
                StreamSupport.stream(images.spliterator(), false)
                        .filter(im -> im.path("face").asBoolean(false))
                        .filter(im -> !im.path("false_face").asBoolean(false))
                        .filter(im -> !im.path("marker").asBoolean(false))
                        .filter(im -> im.path("yaw").isNumber() && im.path("file").isTextual())
                        .min(
                                Comparator.<JsonNode>comparingDouble(FrontFrame::angleFromFront)
                                        .thenComparing(im -> -im.path("sharpness").asDouble(0.0)));
        if (best.isEmpty()) {
            throw new FaceReadingFailure(FaceReadingFailure.NO_FRONT, "no usable face frame");
        }
        if (Math.abs(best.get().path("yaw").asDouble()) > MAX_FRONT_YAW_DEG) {
            throw new FaceReadingFailure(FaceReadingFailure.NO_FRONT, "no frontal frame");
        }
        String file = best.get().path("file").asText();
        if (file.contains("/") || file.contains("..")) {
            throw new FaceReadingFailure(FaceReadingFailure.BAD_BUNDLE, "bad frame name");
        }
        return file;
    }

    /** 긴 변을 {@link #MAX_SIDE} 이하로 줄인 JPEG. 이미 작으면 다시 인코딩만 한다(EXIF 등 메타데이터를 남기지 않으려고). */
    static byte[] shrink(byte[] jpeg) throws IOException {
        BufferedImage source = ImageIO.read(new ByteArrayInputStream(jpeg));
        if (source == null) {
            throw new FaceReadingFailure(FaceReadingFailure.BAD_BUNDLE, "unreadable image");
        }
        double scale =
                Math.min(1.0, (double) MAX_SIDE / Math.max(source.getWidth(), source.getHeight()));
        int width = Math.max(1, (int) Math.round(source.getWidth() * scale));
        int height = Math.max(1, (int) Math.round(source.getHeight() * scale));
        BufferedImage target = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = target.createGraphics();
        try {
            g.setRenderingHint(
                    RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.drawImage(source, 0, 0, width, height, null);
        } finally {
            g.dispose();
        }
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ImageOutputStream stream = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(stream);
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(JPEG_QUALITY);
            writer.write(null, new IIOImage(target, null, null), param);
        } finally {
            writer.dispose();
        }
        return out.toByteArray();
    }
}
