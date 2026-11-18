package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.EyeReview;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class EyeEditValidatorClientTest {
    private static final String MESH = "a".repeat(64);
    private static final String RIG = "b".repeat(64);
    private static final String PARTS = "c".repeat(64);
    private static final AtomicInteger status = new AtomicInteger(200);
    private static final AtomicReference<String> response = new AtomicReference<>();
    private static final AtomicReference<String> body = new AtomicReference<>();
    private static HttpServer server;

    @BeforeAll
    static void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/internal/ai/v1/eye",
                exchange -> {
                    body.set(
                            new String(
                                    exchange.getRequestBody().readAllBytes(),
                                    StandardCharsets.UTF_8));
                    byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(status.get(), bytes.length);
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
    void 전체_눈_상태와_결속을_검사기에_보내고_안전_응답만_받는다() throws Exception {
        status.set(200);
        response.set(result(true, MESH));
        assertThat(check(client("secret"))).isTrue();
        var sent = new ObjectMapper().readTree(body.get());
        assertThat(sent.get("eyeEdit").get("L").get("values").get("height").asDouble())
                .isEqualTo(20);
        assertThat(sent.get("eyePartsSha256").asText()).isEqualTo(PARTS);
    }

    @Test
    void 불안전_응답과_결속_불일치를_구분해_모두_저장하지_않는다() {
        status.set(200);
        response.set(result(false, MESH));
        assertThat(check(client("secret"))).isFalse();
        response.set(result(true, "d".repeat(64)));
        assertThatThrownBy(() -> check(client("secret")))
                .isInstanceOf(EyeEditValidatorClient.InvalidResult.class);
    }

    @Test
    void 검사기_503은_재시도_가능한_일시_오류다() {
        status.set(503);
        response.set(result(true, MESH));
        assertThatThrownBy(() -> check(client("secret")))
                .isInstanceOf(EyeEditValidatorClient.Unavailable.class);
    }

    private static String result(boolean valid, String mesh) {
        return "{\"valid\":"
                + valid
                + ",\"meshSha256\":\""
                + mesh
                + "\",\"rigSha256\":\""
                + RIG
                + "\",\"eyePartsSha256\":\""
                + PARTS
                + "\"}";
    }

    private static EyeEditValidatorClient client(String secret) {
        return new EyeEditValidatorClient(
                "http://127.0.0.1:" + server.getAddress().getPort(), secret, new ObjectMapper());
    }

    private static boolean check(EyeEditValidatorClient client) {
        return client.validate(
                "https://synthetic.invalid/model",
                "https://synthetic.invalid/rig",
                new EyeEditValidatorClient.EyeCapabilitiesBinding(MESH, RIG, PARTS),
                new EyeReview("absent", "absent"),
                EyeEditState.initial());
    }
}
