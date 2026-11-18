package com.preface.api.simulation.service;

import com.preface.api.simulation.dto.PointStroke;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** 사설 CPU 검사기에 원본·리그 URL을 전달하고 응답을 저장 가능한 실제값으로 재검증한다. */
@Component
public class NoseEditValidatorClient {

    private static final Logger log = LoggerFactory.getLogger(NoseEditValidatorClient.class);
    private static final String PATH = "/internal/ai/v1/morph";
    private static final int MAX_RESPONSE_BYTES = 16 * 1024;
    private final URI endpoint;
    private final String secret;
    private final ObjectMapper mapper;
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    public NoseEditValidatorClient(
            @Value("${EDIT_VALIDATOR_URL:}") String baseUrl,
            @Value("${EDIT_VALIDATOR_SECRET:}") String secret,
            ObjectMapper mapper) {
        this.endpoint = baseUrl.isBlank() ? null : URI.create(baseUrl).resolve(PATH);
        this.secret = secret;
        this.mapper = mapper;
    }

    public Map<String, Double> validate(
            String meshUrl,
            String rigUrl,
            NoseEditValidation.Binding approved,
            Map<String, MorphRange> supported,
            Map<String, Double> current,
            Map<String, Double> candidate) {
        return validate(
                        meshUrl, rigUrl, approved, supported, current, candidate, List.of(),
                        List.of())
                .weights();
    }

    public NoseEditValidation.Checked validate(
            String meshUrl,
            String rigUrl,
            NoseEditValidation.Binding approved,
            Map<String, MorphRange> supported,
            Map<String, Double> current,
            Map<String, Double> candidate,
            List<PointStroke> currentPoints,
            List<PointStroke> candidatePoints) {
        if (endpoint == null
                || !("http".equals(endpoint.getScheme()) || "https".equals(endpoint.getScheme()))
                || endpoint.getHost() == null
                || secret.isBlank()
                || approved == null
                || meshUrl == null
                || rigUrl == null) {
            throw new NoseEditValidation.InvalidResult();
        }
        long started = System.nanoTime();
        try {
            HttpRequest request =
                    HttpRequest.newBuilder(endpoint)
                            .timeout(Duration.ofSeconds(48))
                            .header("Content-Type", "application/json")
                            .header("X-Internal-Secret", secret)
                            .POST(
                                    HttpRequest.BodyPublishers.ofString(
                                            mapper.writeValueAsString(
                                                    new Request(
                                                            meshUrl,
                                                            rigUrl,
                                                            approved.meshSha256(),
                                                            approved.rigSha256(),
                                                            current,
                                                            candidate,
                                                            currentPoints,
                                                            candidatePoints))))
                            .build();
            HttpResponse<InputStream> response =
                    http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                if (response.statusCode() == 503) {
                    throw new NoseEditValidation.Unavailable();
                }
                if (response.statusCode() != 200) {
                    throw new NoseEditValidation.InvalidResult();
                }
                byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
                if (bytes.length > MAX_RESPONSE_BYTES) {
                    throw new NoseEditValidation.InvalidResult();
                }
                NoseEditValidation.Result checked =
                        mapper.readValue(
                                new String(bytes, StandardCharsets.UTF_8),
                                NoseEditValidation.Result.class);
                if (!checked.valid()) throw new NoseEditValidation.UnsafeResult();
                return NoseEditValidation.requireSafeActual(
                        approved,
                        supported,
                        current,
                        candidate,
                        currentPoints,
                        candidatePoints,
                        checked);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new NoseEditValidation.Unavailable();
        } catch (NoseEditValidation.InvalidResult
                | NoseEditValidation.UnsafeResult
                | NoseEditValidation.Unavailable e) {
            throw e;
        } catch (IOException e) {
            // 연결 실패·응답 시간 초과(HttpTimeoutException)·끊김: 검사기가 답하지 못한 것이다.
            throw new NoseEditValidation.Unavailable();
        } catch (Exception e) {
            // Signed URLs and internal response bodies must not escape to logs or API errors.
            throw new NoseEditValidation.InvalidResult();
        } finally {
            log.info(
                    "edit_validator stage=round_trip durationMs={}",
                    (System.nanoTime() - started) / 1_000_000);
        }
    }

    private record Request(
            String meshUrl,
            String rigUrl,
            String meshSha256,
            String rigSha256,
            Map<String, Double> currentWeights,
            Map<String, Double> candidateWeights,
            List<PointStroke> currentPointStrokes,
            List<PointStroke> candidatePointStrokes) {}
}
