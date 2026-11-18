package com.preface.api.consult.service;

import com.preface.api.consult.dto.EditAction;
import com.preface.api.consult.dto.SampleConsultRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ConsultErrorCode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/** 기본 모델 채팅은 기존 문장 처리기를 쓰되 시안·대화 저장을 거치지 않는다. */
@Service
@RequiredArgsConstructor
public class SampleConsultService {
    private static final Map<String, String> SAMPLE_SHA =
            Map.of(
                    "base-male", "c856a88dd70667f9be3e17c5eaa3d65760eedfd504a7bf4319ec6ca31bbca1c5",
                    "base-female",
                            "ab4e4d37809b382531ba923e19d7d634c38e93aae027a7265c8a4b3d685d7931");
    private static final Set<String> MORPH_CODES =
            Set.of(
                    "nose.bridge_height",
                    "nose.tip_projection",
                    "nose.tip_height",
                    "nose.tip_rotation",
                    "nose.alar_width",
                    "contour.cheekbone",
                    "contour.cheek_volume",
                    "contour.chin_projection",
                    "contour.chin_length",
                    "contour.chin_width",
                    "contour.jaw_angle",
                    "contour.weight_shape");
    private static final Duration COOLDOWN = Duration.ofSeconds(3);

    private final SpringConsultClient ai;
    private final StringRedisTemplate redis;

    public AiConsult.Response consult(
            String userId, String sampleKey, SampleConsultRequest request) {
        if (!SAMPLE_SHA.containsKey(sampleKey))
            throw new BusinessException(CommonErrorCode.NOT_FOUND);
        if (request == null
                || request.content() == null
                || request.content().isBlank()
                || request.content().length() > 300
                || !SAMPLE_SHA.get(sampleKey).equals(request.meshSha256()))
            throw new BusinessException(ConsultErrorCode.INVALID_MESSAGE);
        try {
            if (!UUID.fromString(request.requestId()).toString().equals(request.requestId()))
                throw new IllegalArgumentException();
        } catch (RuntimeException e) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        Map<String, Double> weights = request.weights() == null ? Map.of() : request.weights();
        if (weights.size() > MORPH_CODES.size()
                || weights.entrySet().stream()
                        .anyMatch(
                                entry ->
                                        !MORPH_CODES.contains(entry.getKey())
                                                || entry.getValue() == null
                                                || !Double.isFinite(entry.getValue())
                                                || Math.abs(entry.getValue()) > 1))
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        List<String> rendered = request.supportedCodes();
        if (rendered == null || rendered.size() > 32)
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        List<String> allowed = new ArrayList<>();
        rendered.stream().filter(MORPH_CODES::contains).distinct().forEach(allowed::add);
        if (request.eyeAvailable()) {
            allowed.addAll(EyeConsultEdits.CODES);
            if (!request.eyeFoldEnabled()) {
                allowed.remove("eye.height");
                allowed.remove(EyeConsultEdits.FOLD_OFF);
            }
        }
        String content = request.content().strip();
        var command = ConsultCommand.parse(content);
        if (command.isPresent()) {
            if (command.get() == ConsultCommand.UNDO
                    || command.get() == ConsultCommand.REDO
                    || command.get() == ConsultCommand.RESET)
                return new AiConsult.Response(
                        content,
                        false,
                        "",
                        command.get().name(),
                        null,
                        false,
                        List.of(),
                        false,
                        null);
        }
        if (!Boolean.TRUE.equals(
                redis.opsForValue()
                        .setIfAbsent("consult:sample:cooldown:" + userId, "1", COOLDOWN)))
            throw new BusinessException(CommonErrorCode.TOO_MANY_REQUESTS);
        boolean otherEdits =
                request.eyeEdited()
                        || weights.entrySet().stream()
                                .anyMatch(
                                        entry ->
                                                !"contour.weight_shape".equals(entry.getKey())
                                                        && entry.getValue() != 0);
        AiConsult.Response response =
                ai.consult(
                        new AiConsult.Request(
                                "sample:" + userId + ":" + sampleKey,
                                request.requestId(),
                                new AiConsult.Message(content, null),
                                null,
                                List.of(),
                                Map.of(),
                                new AiConsult.MorphStateBody("v2", weights, otherEdits),
                                List.of("EYE", "NOSE", "CONTOUR"),
                                allowed));
        if (response == null
                || (response.changeRequest() != null
                        && (response.changeRequest().actions() == null
                                || response.changeRequest().actions().stream()
                                        .anyMatch(action -> !safeAction(action, allowed)))))
            throw new BusinessException(ConsultErrorCode.NOT_APPLICABLE);
        if (response.changeRequest() != null) {
            var actions = response.changeRequest().actions();
            boolean asksWeight =
                    actions.stream()
                            .anyMatch(action -> action.code().equals("contour.weight_shape"));
            boolean asksFace =
                    actions.stream()
                            .anyMatch(action -> !action.code().equals("contour.weight_shape"));
            if ((asksWeight && (asksFace || otherEdits))
                    || (asksFace && weights.getOrDefault("contour.weight_shape", 0.0) != 0)) {
                return new AiConsult.Response(
                        response.maskedUserContent(),
                        response.masked(),
                        "체중 변화는 눈·코·윤곽과 따로 조절할 수 있어요. 직접 조절에서 원하는 모드로 전환해 주세요. 얼굴은 바꾸지 않았어요.",
                        "REPLY",
                        null,
                        false,
                        List.of(),
                        response.filtered(),
                        null);
            }
        }
        return response;
    }

    private static boolean safeAction(EditAction action, List<String> allowed) {
        return ConsultEdits.isValid(action)
                && allowed.contains(action.code())
                && (action.code().startsWith("eye.")
                        || ConsultEdits.CHAT_NOSE_CODES.contains(action.code())
                        || ConsultEdits.CHAT_CONTOUR_CODES.contains(action.code()));
    }
}
