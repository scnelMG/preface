package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.preface.common.error.BusinessException;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class WeightContourValidatorClientTest {
    private static final String MESH = "a".repeat(64);
    private static final String FIT = "b".repeat(12);
    private static final Map<String, Double> WEIGHTS =
            Map.of("contour.weight_shape", -0.4, "contour.cheek_volume", 0.2);
    private static final AtomicReference<String> response = new AtomicReference<>();
    private static HttpServer server;

    @BeforeAll
    static void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/internal/ai/v1/composite",
                exchange -> {
                    byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, bytes.length);
                    exchange.getResponseBody().write(bytes);
                    exchange.close();
                });
        server.start();
    }

    @AfterAll
    static void stop() {
        server.stop(0);
    }

    @Test
    void 검사기의_안전_응답이_요청한_메시와_가중치에_결속돼야_한다() {
        String valid =
                "{\"valid\":true,\"validatorVersion\":1,\"meshSha256\":\""
                        + MESH
                        + "\",\"fitSha\":\""
                        + FIT
                        + "\",\"weights\":{\"contour.weight_shape\":-0.4,\"contour.cheek_volume\":0.2}}";
        response.set(valid);
        assertThat(check()).isTrue();
        response.set(valid.replace("-0.4", "-0.3"));
        assertThat(check()).isFalse();
        response.set(valid.replace(MESH, "c".repeat(64)));
        assertThat(check()).isFalse();
        response.set(valid.replace("\"validatorVersion\":1", "\"validatorVersion\":2"));
        assertThat(check()).isFalse();
        response.set(valid.replace("\"valid\":true", "\"valid\":false"));
        assertThat(check()).isFalse();
    }

    @Test
    void 검사기_오류나_비밀값_누락은_저장을_허용하지_않는다() {
        response.set("{\"valid\":false}");
        assertThatThrownBy(WeightContourValidatorClientTest::check)
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(
                        () ->
                                new WeightContourValidatorClient(
                                                "http://127.0.0.1:" + server.getAddress().getPort(),
                                                "",
                                                new ObjectMapper())
                                        .validate(
                                                "https://example.invalid/mesh", MESH, FIT, WEIGHTS))
                .isInstanceOf(BusinessException.class);
    }

    private static boolean check() {
        return new WeightContourValidatorClient(
                        "http://127.0.0.1:" + server.getAddress().getPort(),
                        "synthetic-secret",
                        new ObjectMapper())
                .validate("https://example.invalid/mesh", MESH, FIT, WEIGHTS);
    }
}
