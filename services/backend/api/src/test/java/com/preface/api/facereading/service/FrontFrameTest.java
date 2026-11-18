package com.preface.api.facereading.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** 묶음(tar)에서 정면 프레임을 고르고 줄이는 규칙. 이미지는 단색 합성 이미지만 쓴다(얼굴 사진 아님). */
class FrontFrameTest {

    private final ObjectMapper mapper = JsonMapper.builder().build();

    @Test
    void 얼굴이_있는_프레임_중_yaw가_가장_작은_것을_고르고_같으면_선명한_것을_고른다() {
        String prepare =
                """
                {"images":[
                  {"file":"a.jpg","face":true,"yaw":-12.0,"sharpness":50},
                  {"file":"b.jpg","face":true,"yaw":3.0,"sharpness":10},
                  {"file":"c.jpg","face":true,"yaw":-3.0,"sharpness":90},
                  {"file":"d.jpg","face":true,"false_face":true,"yaw":0.0},
                  {"file":"e.jpg","face":false,"yaw":0.5},
                  {"file":"f.jpg","face":true,"marker":true,"yaw":0.1}
                ]}
                """;
        assertThat(FrontFrame.pick(mapper.readTree(prepare))).isEqualTo("c.jpg");
    }

    @Test
    void 좌우만이_아니라_고개_상하까지_보고_정면을_고른다() {
        // chae01(11/08): 좌우 0°지만 고개를 든 프레임(pitch 26.6)이 뽑혔다. 좌우·상하가 모두 작은 프레임을 고른다
        String prepare =
                """
                {"images":[
                  {"file":"chin-up.jpg","face":true,"yaw":0.0,"pitch":26.6,"sharpness":90},
                  {"file":"level.jpg","face":true,"yaw":-1.6,"pitch":1.4,"sharpness":40},
                  {"file":"down.jpg","face":true,"yaw":0.5,"pitch":-11.1,"sharpness":80}
                ]}
                """;
        assertThat(FrontFrame.pick(mapper.readTree(prepare))).isEqualTo("level.jpg");
    }

    @Test
    void 정면에_가까운_프레임이_없거나_얼굴이_없으면_NO_FRONT로_실패한다() {
        assertFailure(
                () ->
                        FrontFrame.pick(
                                mapper.readTree(
                                        "{\"images\":[{\"file\":\"a.jpg\",\"face\":true,\"yaw\":40}]}")),
                FaceReadingFailure.NO_FRONT);
        assertFailure(
                () -> FrontFrame.pick(mapper.readTree("{\"images\":[]}")),
                FaceReadingFailure.NO_FRONT);
    }

    @Test
    void 파일_이름에_경로가_섞이면_묶음_밖을_읽지_않고_실패한다() {
        assertFailure(
                () ->
                        FrontFrame.pick(
                                mapper.readTree(
                                        "{\"images\":[{\"file\":\"../x.jpg\",\"face\":true,\"yaw\":0}]}")),
                FaceReadingFailure.BAD_BUNDLE);
    }

    @Test
    void 묶음에서_정면_프레임을_꺼내_긴_변_768px_JPEG로_줄인다() throws IOException {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("manifest.json", "{}".getBytes(StandardCharsets.UTF_8));
        entries.put(
                "prepare.json",
                "{\"images\":[{\"file\":\"v0_00001.jpg\",\"face\":true,\"yaw\":1.5}]}"
                        .getBytes(StandardCharsets.UTF_8));
        entries.put("images/v0_00001.jpg", jpeg(1080, 1920));
        entries.put("masks/v0_00001.png", new byte[] {1, 2, 3});

        byte[] front = FrontFrame.fromBundle(new ByteArrayInputStream(TestTar.of(entries)), mapper);

        BufferedImage image = ImageIO.read(new ByteArrayInputStream(front));
        assertThat(image.getHeight()).isEqualTo(768);
        assertThat(image.getWidth()).isEqualTo(432);
    }

    @Test
    void prepare_json이나_고른_이미지가_묶음에_없으면_BAD_BUNDLE이다() throws IOException {
        Map<String, byte[]> noPrepare = Map.of("images/a.jpg", jpeg(10, 10));
        assertFailure(
                () ->
                        FrontFrame.fromBundle(
                                new ByteArrayInputStream(TestTar.of(noPrepare)), mapper),
                FaceReadingFailure.BAD_BUNDLE);

        Map<String, byte[]> noImage =
                Map.of(
                        "prepare.json",
                        "{\"images\":[{\"file\":\"a.jpg\",\"face\":true,\"yaw\":0}]}"
                                .getBytes(StandardCharsets.UTF_8));
        assertFailure(
                () -> FrontFrame.fromBundle(new ByteArrayInputStream(TestTar.of(noImage)), mapper),
                FaceReadingFailure.BAD_BUNDLE);
    }

    @Test
    void tar가_중간에_잘리면_BAD_BUNDLE이다() throws IOException {
        byte[] tar = TestTar.of(Map.of("prepare.json", new byte[2000]));
        byte[] cut = java.util.Arrays.copyOf(tar, 900);
        assertFailure(
                () -> BundleTar.read(new ByteArrayInputStream(cut), name -> true),
                FaceReadingFailure.BAD_BUNDLE);
    }

    private static byte[] jpeg(int width, int height) throws IOException {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(new Color(180, 140, 120));
        g.fillRect(0, 0, width, height);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "jpeg", out);
        return out.toByteArray();
    }

    private static void assertFailure(ThrowingRunnable call, String code) {
        assertThatThrownBy(call::run)
                .isInstanceOf(FaceReadingFailure.class)
                .extracting(e -> ((FaceReadingFailure) e).code())
                .isEqualTo(code);
    }

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
