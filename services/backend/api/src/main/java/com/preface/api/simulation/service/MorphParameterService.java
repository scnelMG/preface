package com.preface.api.simulation.service;

import com.preface.api.simulation.dto.MorphParametersResponse;
import com.preface.common.simulation.entity.MorphParameter;
import com.preface.common.simulation.repository.MorphParameterRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** morph 파라미터(슬라이더 항목·허용 범위). 행 수가 수십 개라 매번 DB에서 읽는다. */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MorphParameterService {

    private static final Map<String, String> PART_LABELS =
            Map.of("EYE", "눈", "NOSE", "코", "CONTOUR", "윤곽");

    private final MorphParameterRepository repository;

    /** API-EDIT-01. 부위 순서는 각 부위의 첫 항목 {@code sort_order} 순이다. 모르는 스키마 버전이면 빈 목록. */
    public MorphParametersResponse list(String schemaVersion) {
        Map<String, List<MorphParametersResponse.Item>> byPart = new LinkedHashMap<>();
        for (MorphParameter p : active(schemaVersion)) {
            byPart.computeIfAbsent(p.getPart(), k -> new ArrayList<>())
                    .add(
                            new MorphParametersResponse.Item(
                                    p.getCode(),
                                    p.getSubPart(),
                                    p.getLabel(),
                                    p.getMinValue().doubleValue(),
                                    p.getMaxValue().doubleValue(),
                                    p.getDefaultValue().doubleValue(),
                                    p.getStep().doubleValue()));
        }
        List<MorphParametersResponse.Part> parts =
                byPart.entrySet().stream()
                        .map(
                                e ->
                                        new MorphParametersResponse.Part(
                                                e.getKey(),
                                                PART_LABELS.getOrDefault(e.getKey(), e.getKey()),
                                                e.getValue()))
                        .toList();
        return new MorphParametersResponse(schemaVersion, parts);
    }

    /** 편집 검증용. code → 허용 범위. 비활성 항목은 없는 것으로 본다(EDIT_001). */
    public Map<String, MorphRange> ranges(String schemaVersion) {
        Map<String, MorphRange> ranges = new LinkedHashMap<>();
        for (MorphParameter p : active(schemaVersion)) {
            ranges.put(
                    p.getCode(),
                    new MorphRange(
                            p.getCode(),
                            p.getLabel(),
                            p.getMinValue().doubleValue(),
                            p.getMaxValue().doubleValue()));
        }
        return ranges;
    }

    /** 시안 목록의 변경 부위(API-HIS-06)용. {@code sort_order} 순 code → (부위, 기본값). */
    public Map<String, ChangedParts.PartOf> partsByCode(String schemaVersion) {
        Map<String, ChangedParts.PartOf> parts = new LinkedHashMap<>();
        for (MorphParameter p : active(schemaVersion)) {
            parts.put(
                    p.getCode(),
                    new ChangedParts.PartOf(p.getPart(), p.getDefaultValue().doubleValue()));
        }
        return parts;
    }

    private List<MorphParameter> active(String schemaVersion) {
        return repository.findAllBySchemaVersionAndActiveTrueOrderBySortOrderAsc(schemaVersion);
    }
}
