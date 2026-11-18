package com.preface.api.consult;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * GMS 상담을 흉내 내는 테스트 서버(JDK 내장 HttpServer — 의존성 추가 없음). 받은 본문·인증 헤더를 모아 두고, 정해 둔 상태 코드·본문·지연으로 답한다.
 */
public final class FakeAiServer implements AutoCloseable {

    private final HttpServer server;
    private final List<String> bodies = new CopyOnWriteArrayList<>();
    private final List<String> secrets = new CopyOnWriteArrayList<>();
    private volatile int status = 200;
    private volatile String response = "{}";
    private volatile long delayMillis;
    private static final ObjectMapper JSON = new ObjectMapper();

    public FakeAiServer() {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext(
                "/internal/ai/v1/consult",
                exchange -> {
                    try (InputStream in = exchange.getRequestBody()) {
                        bodies.add(new String(in.readAllBytes(), StandardCharsets.UTF_8));
                    }
                    secrets.add(exchange.getRequestHeaders().getFirst("X-Internal-Secret"));
                    if (delayMillis > 0) {
                        try {
                            Thread.sleep(delayMillis);
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        }
                    }
                    byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    try {
                        exchange.sendResponseHeaders(status, bytes.length);
                        try (OutputStream out = exchange.getResponseBody()) {
                            out.write(bytes);
                        }
                    } catch (IOException ignored) {
                        // 클라이언트가 시간 초과로 먼저 끊은 경우
                    }
                });
        server.createContext(
                "/key-info",
                exchange -> {
                    byte[] bytes = "{\"remainCredit\":2000000}".getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, bytes.length);
                    try (OutputStream out = exchange.getResponseBody()) {
                        out.write(bytes);
                    }
                });
        server.createContext(
                "/api.openai.com/v1/responses",
                exchange -> {
                    try (InputStream in = exchange.getRequestBody()) {
                        bodies.add(new String(in.readAllBytes(), StandardCharsets.UTF_8));
                    }
                    secrets.add(exchange.getRequestHeaders().getFirst("Authorization"));
                    if (delayMillis > 0) {
                        try {
                            Thread.sleep(delayMillis);
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        }
                    }
                    byte[] bytes =
                            (status == 200 ? gms(response) : response)
                                    .getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    try {
                        exchange.sendResponseHeaders(status, bytes.length);
                        try (OutputStream out = exchange.getResponseBody()) {
                            out.write(bytes);
                        }
                    } catch (IOException ignored) {
                        // 클라이언트가 시간 초과로 먼저 끊은 경우
                    }
                });
        server.start();
    }

    public String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** 다음 응답들. */
    public void respond(int status, String body) {
        this.status = status;
        this.response = body;
        this.delayMillis = 0;
    }

    public void delay(long millis) {
        this.delayMillis = millis;
    }

    public List<String> bodies() {
        return bodies;
    }

    public List<String> secrets() {
        return secrets;
    }

    public String lastBody() {
        return bodies.getLast();
    }

    public void reset() {
        bodies.clear();
        secrets.clear();
        respond(200, "{}");
    }

    @Override
    public void close() {
        server.stop(0);
    }

    private static String gms(String response) {
        ObjectNode old = (ObjectNode) JSON.readTree(response);
        String masked = old.path("maskedUserContent").asText();
        ArrayNode actions =
                old.path("changeRequest").path("actions").isArray()
                        ? (ArrayNode) old.path("changeRequest").path("actions").deepCopy()
                        : JSON.createArrayNode();
        for (var action : actions) {
            if (!action.has("source")) ((ObjectNode) action).put("source", masked);
        }
        ArrayNode options =
                old.path("options").isArray()
                        ? (ArrayNode) old.path("options").deepCopy()
                        : JSON.createArrayNode();
        for (var option : options) {
            for (var action : option.path("actions")) {
                if (!action.has("source")) ((ObjectNode) action).put("source", masked);
            }
        }
        Map<String, Object> intent = new LinkedHashMap<>();
        intent.put("kind", old.path("intent").asText().toLowerCase());
        intent.put("message", old.path("assistantMessage").asText());
        intent.put("maskedUserContent", masked);
        intent.put("actions", actions);
        intent.put("options", options);
        intent.put(
                "skipped",
                old.path("changeRequest").path("skipped").isArray()
                        ? old.path("changeRequest").path("skipped")
                        : JSON.createArrayNode());
        String raw = JSON.writeValueAsString(intent);
        return JSON.writeValueAsString(
                Map.of(
                        "status",
                        "completed",
                        "output",
                        List.of(
                                Map.of(
                                        "content",
                                        List.of(Map.of("type", "output_text", "text", raw))))));
    }

    // ---- 계약 형식(services/gpu-worker/app/consult.py) 응답 예시 ----

    public static String edit(String masked, String actionsJson, String skippedJson) {
        return "{\"maskedUserContent\":\""
                + masked
                + "\",\"masked\":false,\"assistantMessage\":\"\",\"intent\":\"EDIT\","
                + "\"changeRequest\":{\"status\":\"COMPLETE\",\"schemaVersion\":\"v2\",\"actions\":"
                + actionsJson
                + ",\"skipped\":"
                + skippedJson
                + "},\"needsClarification\":false,\"options\":[],\"filtered\":false,"
                + "\"recommendedSliderCode\":null}";
    }

    public static String clarify(String masked, String message, String optionsJson) {
        return "{\"maskedUserContent\":\""
                + masked
                + "\",\"masked\":false,\"assistantMessage\":\""
                + message
                + "\",\"intent\":\"CLARIFY\",\"changeRequest\":null,\"needsClarification\":true,"
                + "\"options\":"
                + optionsJson
                + ",\"filtered\":false,\"recommendedSliderCode\":null}";
    }

    public static String reply(String masked, boolean wasMasked, String message) {
        return "{\"maskedUserContent\":\""
                + masked
                + "\",\"masked\":"
                + wasMasked
                + ",\"assistantMessage\":\""
                + message
                + "\",\"intent\":\"REPLY\",\"changeRequest\":null,\"needsClarification\":false,"
                + "\"options\":[],\"filtered\":false,\"recommendedSliderCode\":null}";
    }
}
