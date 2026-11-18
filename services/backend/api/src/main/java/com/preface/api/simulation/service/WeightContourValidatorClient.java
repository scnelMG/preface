package com.preface.api.simulation.service;

import com.preface.api.simulation.dto.EyeEditState;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** 사설 검사기의 최종 피부 판정을 해시·가중치까지 결속해 읽는다. */
@Component
public class WeightContourValidatorClient {
    private static final int MAX_RESPONSE_BYTES = 16 * 1024;
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(80);
    private final URI endpoint;
    private final String secret;
    private final ObjectMapper mapper;
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    public WeightContourValidatorClient(
            @Value("${EDIT_VALIDATOR_URL:}") String baseUrl,
            @Value("${EDIT_VALIDATOR_SECRET:}") String secret,
            ObjectMapper mapper) {
        this.endpoint =
                baseUrl.isBlank() ? null : URI.create(baseUrl).resolve("/internal/ai/v1/composite");
        this.secret = secret;
        this.mapper = mapper;
    }

    public boolean validate(
            String meshUrl, String meshSha256, String fitSha, Map<String, Double> weights) {
        return execute(
                new Request(meshUrl, meshSha256, fitSha, weights, 1, null, null, null, null, null));
    }

    public boolean validateFull(
            String meshUrl,
            String meshSha256,
            String fitSha,
            Map<String, Double> weights,
            String rigUrl,
            String rigSha256,
            String eyePartsSha256,
            EyeReview review,
            EyeEditState eyes) {
        return execute(
                new Request(
                        meshUrl,
                        meshSha256,
                        fitSha,
                        weights,
                        2,
                        rigUrl,
                        rigSha256,
                        eyePartsSha256,
                        review,
                        eyes));
    }

    private boolean execute(Request input) {
        if (endpoint == null
                || !("http".equals(endpoint.getScheme()) || "https".equals(endpoint.getScheme()))
                || endpoint.getHost() == null
                || secret.isBlank()) {
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
        try {
            HttpRequest request =
                    HttpRequest.newBuilder(endpoint)
                            .timeout(REQUEST_TIMEOUT)
                            .header("Content-Type", "application/json")
                            .header("X-Internal-Secret", secret)
                            .POST(
                                    HttpRequest.BodyPublishers.ofString(
                                            mapper.writeValueAsString(input)))
                            .build();
            HttpResponse<byte[]> response =
                    http.send(
                            request,
                            HttpResponse.BodyHandlers.limiting(
                                    HttpResponse.BodyHandlers.ofByteArray(), MAX_RESPONSE_BYTES));
            if (response.statusCode() != 200) return false;
            Result result =
                    mapper.readValue(
                            new String(response.body(), StandardCharsets.UTF_8), Result.class);
            return result.valid()
                    && result.validatorVersion() == input.validatorVersion()
                    && input.meshSha256().equals(result.meshSha256())
                    && input.fitSha().equals(result.fitSha())
                    && input.weights().equals(result.weights())
                    && (input.validatorVersion() == 1
                            || (Objects.equals(input.rigSha256(), result.rigSha256())
                                    && Objects.equals(input.eyeEdit(), result.eyeEdit())));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        } catch (Exception e) {
            // 서명 URL·검사기 내부 오류는 API 응답과 로그에 남기지 않는다.
            throw new BusinessException(EditErrorCode.UNKNOWN_MORPH_CODE);
        }
    }

    private record Request(
            String meshUrl,
            String meshSha256,
            String fitSha,
            Map<String, Double> weights,
            int validatorVersion,
            String rigUrl,
            String rigSha256,
            String eyePartsSha256,
            EyeReview review,
            EyeEditState eyeEdit) {}

    private record Result(
            boolean valid,
            int validatorVersion,
            String meshSha256,
            String fitSha,
            Map<String, Double> weights,
            String rigSha256,
            EyeEditState eyeEdit) {}
}
