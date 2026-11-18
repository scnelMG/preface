package com.preface.api.simulation.service;

import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.EyeReview;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** 승인된 원본의 눈 전체 형상을 사설 CPU 검사기로 확인한다. */
@Component
public class EyeEditValidatorClient {
    private static final int MAX_RESPONSE_BYTES = 1024;
    private final URI endpoint;
    private final String secret;
    private final ObjectMapper mapper;
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    public EyeEditValidatorClient(
            @Value("${EDIT_VALIDATOR_URL:}") String baseUrl,
            @Value("${EDIT_VALIDATOR_SECRET:}") String secret,
            ObjectMapper mapper) {
        endpoint = baseUrl.isBlank() ? null : URI.create(baseUrl).resolve("/internal/ai/v1/eye");
        this.secret = secret;
        this.mapper = mapper;
    }

    public boolean validate(
            String meshUrl,
            String rigUrl,
            EyeCapabilitiesBinding binding,
            EyeReview review,
            EyeEditState state) {
        if (endpoint == null
                || !("http".equals(endpoint.getScheme()) || "https".equals(endpoint.getScheme()))
                || endpoint.getHost() == null
                || secret.isBlank()) {
            throw new InvalidResult();
        }
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
                                                            binding.meshSha256(),
                                                            binding.rigSha256(),
                                                            binding.eyePartsSha256(),
                                                            review,
                                                            state))))
                            .build();
            HttpResponse<InputStream> response =
                    http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                if (response.statusCode() == 429 || response.statusCode() >= 500)
                    throw new Unavailable();
                if (response.statusCode() != 200) throw new InvalidResult();
                byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
                if (bytes.length > MAX_RESPONSE_BYTES) throw new InvalidResult();
                Result result =
                        mapper.readValue(new String(bytes, StandardCharsets.UTF_8), Result.class);
                if (result == null
                        || !binding.meshSha256().equals(result.meshSha256())
                        || !binding.rigSha256().equals(result.rigSha256())
                        || !binding.eyePartsSha256().equals(result.eyePartsSha256())) {
                    throw new InvalidResult();
                }
                return result.valid();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Unavailable();
        } catch (java.io.IOException e) {
            throw new Unavailable();
        } catch (InvalidResult | Unavailable e) {
            throw e;
        } catch (Exception e) {
            // Signed URLs and response bodies must never escape to logs or API errors.
            throw new InvalidResult();
        }
    }

    public record EyeCapabilitiesBinding(
            String meshSha256, String rigSha256, String eyePartsSha256) {}

    private record Request(
            String meshUrl,
            String rigUrl,
            String meshSha256,
            String rigSha256,
            String eyePartsSha256,
            EyeReview review,
            EyeEditState eyeEdit) {}

    private record Result(
            boolean valid, String meshSha256, String rigSha256, String eyePartsSha256) {}

    public static final class InvalidResult extends RuntimeException {}

    public static final class Unavailable extends RuntimeException {}
}
