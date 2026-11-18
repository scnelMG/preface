package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.preface.api.simulation.dto.PointStroke;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class NoseEditValidatorClientTest {

    private static HttpServer server;
    private static final AtomicInteger status = new AtomicInteger(200);
    private static final AtomicReference<String> lastSecret = new AtomicReference<>();
    private static final AtomicReference<String> lastBody = new AtomicReference<>();
    private static final String VALID_RESPONSE =
            "{\"valid\":true,\"actualWeights\":{\"nose.bridge_height\":0.35},"
                    + "\"meshSha256\":\"mesh\",\"rigSha256\":\"rig\",\"fitSha\":\"fit\","
                    + "\"engine\":\"engine\",\"rigVersion\":\"v1\",\"topologyVersion\":\"topology\","
                    + "\"canonicalValid\":true,\"skinValid\":true,\"selfIntersections\":0}";
    private static final AtomicReference<String> response = new AtomicReference<>(VALID_RESPONSE);

    @BeforeAll
    static void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/internal/ai/v1/morph",
                exchange -> {
                    lastSecret.set(exchange.getRequestHeaders().getFirst("X-Internal-Secret"));
                    lastBody.set(
                            new String(
                                    exchange.getRequestBody().readAllBytes(),
                                    StandardCharsets.UTF_8));
                    byte[] data = response.get().getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(status.get(), data.length);
                    exchange.getResponseBody().write(data);
                    exchange.close();
                });
        server.start();
    }

    @AfterAll
    static void stop() {
        server.stop(0);
    }

    @Test
    void 내부_검사기에_요청하고_검증된_실제값만_반환한다() throws Exception {
        status.set(200);
        response.set(VALID_RESPONSE);
        NoseEditValidatorClient client = client("secret");
        Map<String, Double> actual = check(client);

        assertThat(actual).containsEntry("nose.bridge_height", 0.35);
        assertThat(lastSecret.get()).isEqualTo("secret");
        assertThat(new ObjectMapper().readTree(lastBody.get()).get("meshSha256").asText())
                .isEqualTo("mesh");
    }

    @Test
    void 검사기_장애나_비밀값_누락은_성공값을_내지_않는다() {
        status.set(503);
        response.set(VALID_RESPONSE);
        assertThatThrownBy(() -> check(client("secret")))
                .isInstanceOf(NoseEditValidation.Unavailable.class)
                .hasMessageNotContaining("example.invalid");
        assertThatThrownBy(() -> check(client("")))
                .isInstanceOf(NoseEditValidation.InvalidResult.class);
    }

    @Test
    void 검사기가_바쁘거나_닿지_않으면_일시_불가로_입력_검사_실패와_구분한다() throws Exception {
        status.set(503);
        response.set("{\"error\":\"EDIT_VALIDATOR_BUSY\"}");
        assertThatThrownBy(() -> check(client("secret")))
                .isInstanceOf(NoseEditValidation.Unavailable.class);

        status.set(422);
        response.set("{\"error\":\"EDIT_VALIDATION_FAILED\"}");
        assertThatThrownBy(() -> check(client("secret")))
                .isInstanceOf(NoseEditValidation.InvalidResult.class);

        int closedPort;
        try (java.net.ServerSocket socket = new java.net.ServerSocket(0)) {
            closedPort = socket.getLocalPort();
        }
        NoseEditValidatorClient unreachable =
                new NoseEditValidatorClient(
                        "http://127.0.0.1:" + closedPort, "secret", new ObjectMapper());
        assertThatThrownBy(() -> check(unreachable))
                .isInstanceOf(NoseEditValidation.Unavailable.class)
                .hasMessageNotContaining("example.invalid");
    }

    @Test
    void 검사기_응답이_상한을_넘으면_거절한다() {
        status.set(200);
        response.set(" ".repeat(20 * 1024));
        assertThatThrownBy(() -> check(client("secret")))
                .isInstanceOf(NoseEditValidation.InvalidResult.class);
    }

    @Test
    void 최종_메시가_안전하지_않으면_검사_장애와_구분한다() {
        status.set(200);
        response.set(VALID_RESPONSE.replace("\"valid\":true", "\"valid\":false"));
        assertThatThrownBy(() -> check(client("secret")))
                .isInstanceOf(NoseEditValidation.UnsafeResult.class);
    }

    @Test
    void 점_변위_검사기는_요청한_배열과_같은_실제값만_받는다() throws Exception {
        status.set(200);
        response.set(
                VALID_RESPONSE.replace(
                        "\"actualWeights\"",
                        "\"actualPointStrokes\":[{\"vertex\":3,\"delta\":[0,0.01,0]}],\"actualWeights\""));
        List<PointStroke> points = List.of(new PointStroke(3, List.of(0.0, 0.01, 0.0)));
        NoseEditValidation.Checked result =
                client("secret")
                        .validate(
                                "https://example.invalid/model.glb",
                                "https://example.invalid/rig.json",
                                new NoseEditValidation.Binding(
                                        "mesh", "rig", "fit", "engine", "v1", "topology"),
                                Map.of(
                                        "nose.bridge_height",
                                        new MorphRange("nose.bridge_height", "콧대", -0.4, 0.6)),
                                Map.of("nose.bridge_height", 0.2),
                                Map.of("nose.bridge_height", 0.5),
                                List.of(),
                                points);
        assertThat(result.points()).isEqualTo(points);
        assertThat(new ObjectMapper().readTree(lastBody.get()).get("candidatePointStrokes").size())
                .isEqualTo(1);
    }

    private static NoseEditValidatorClient client(String secret) {
        return new NoseEditValidatorClient(
                "http://127.0.0.1:" + server.getAddress().getPort(), secret, new ObjectMapper());
    }

    private static Map<String, Double> check(NoseEditValidatorClient client) {
        return client.validate(
                "https://example.invalid/model.glb",
                "https://example.invalid/rig.json",
                new NoseEditValidation.Binding("mesh", "rig", "fit", "engine", "v1", "topology"),
                Map.of(
                        "nose.bridge_height",
                        new MorphRange("nose.bridge_height", "콧대 높이", -0.4, 0.6)),
                Map.of("nose.bridge_height", 0.2),
                Map.of("nose.bridge_height", 0.5));
    }
}
