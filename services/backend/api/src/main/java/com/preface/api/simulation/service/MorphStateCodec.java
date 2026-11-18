package com.preface.api.simulation.service;

import com.preface.api.simulation.dto.MorphState;
import com.preface.api.simulation.dto.PointStroke;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code morph_state}·{@code state_after}·{@code delta}(MySQL JSON 컬럼) ↔ 객체 변환.
 *
 * <p>엔티티는 JSON을 문자열로만 들고, 변환은 여기서 한다. Hibernate JSON 매핑({@code @JdbcTypeCode(SqlTypes.JSON)})은
 * Jackson 2·3이 함께 있는 classpath에서 어느 쪽을 고를지가 Hibernate 버전에 따라 달라 쓰지 않았다.
 */
@Component
@RequiredArgsConstructor
public class MorphStateCodec {

    private final JsonMapper jsonMapper;

    public MorphState read(String json) {
        MorphState state = jsonMapper.readValue(json, MorphState.class);
        Map<String, Double> weights =
                state.weights() == null ? new TreeMap<>() : new TreeMap<>(state.weights());
        return new MorphState(
                state.schemaVersion(),
                weights,
                state.pointStrokes() == null ? List.of() : List.copyOf(state.pointStrokes()),
                state.eyeEdit());
    }

    public String write(MorphState state) {
        return jsonMapper.writeValueAsString(state);
    }

    public String writeDelta(List<MorphEdits.Change> changes) {
        return jsonMapper.writeValueAsString(changes);
    }

    public String writePointStrokes(List<PointStroke> strokes) {
        return jsonMapper.writeValueAsString(strokes);
    }
}
