package com.preface.api.hair.service;

import com.preface.api.hair.dto.HairSuggestion;
import com.preface.api.hair.dto.HairTemplateListResponse;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.reconstruction.service.ReconstructionStorage.PresignedUrl;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import com.preface.common.hair.entity.HairTemplate;
import com.preface.common.hair.repository.HairTemplateRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/** 헤어 템플릿 목록(API-HAIR-01)·추천·존재 확인(S15P31B204-551). */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class HairTemplateService {

    private static final List<String> LENGTHS = List.of("short", "medium", "long");
    private static final List<String> BANGS = List.of("none", "partial", "full");

    private final HairTemplateRepository hairTemplateRepository;
    private final ReconstructionStorage storage;
    private final ObjectMapper objectMapper;

    public HairTemplateListResponse list() {
        List<HairTemplate> templates =
                hairTemplateRepository.findAllByActiveTrueOrderBySortOrderAsc();
        Instant expiresAt = null;
        List<HairTemplateListResponse.Item> items = new ArrayList<>();
        for (HairTemplate t : templates) {
            PresignedUrl mesh = storage.presignGet(t.getMeshObjectKey());
            expiresAt = expiresAt == null ? mesh.expiresAt() : expiresAt;
            items.add(item(t, mesh));
        }
        return new HairTemplateListResponse(items, expiresAt);
    }

    /** 노출 중인 템플릿 한 개(시안 공유 보기, S15P31B204-574). 없거나 숨긴 템플릿이면 비어 있다. */
    public Optional<HairTemplateListResponse.Item> item(String hairTemplateId) {
        return hairTemplateRepository
                .findByIdAndActiveTrue(hairTemplateId)
                .map(t -> item(t, storage.presignGet(t.getMeshObjectKey())));
    }

    private HairTemplateListResponse.Item item(HairTemplate t, PresignedUrl mesh) {
        return new HairTemplateListResponse.Item(
                t.getId(),
                t.getName(),
                mesh.url(),
                url(t.getBindingObjectKey()),
                url(t.getThumbnailObjectKey()),
                t.getHeadTemplate(),
                t.getLength(),
                t.getBangs(),
                t.getPart(),
                t.getBaseRgb());
    }

    /**
     * {@code face_model.hair_meta} → 3D 상세의 헤어 항목. 저장 때 형식을 검사했지만, 읽을 수 없으면 추천 없이 {@code null}로
     * 둔다(상세 조회를 깨지 않는다).
     */
    public HairSuggestion suggest(String hairMetaJson) {
        if (hairMetaJson == null || hairMetaJson.isBlank()) {
            return null;
        }
        Map<?, ?> meta;
        try {
            meta = objectMapper.readValue(hairMetaJson, Map.class);
        } catch (JacksonException e) {
            log.warn("hair_meta unreadable, no suggestion");
            return null;
        }
        String length = text(meta, "length");
        String bangs = text(meta, "bangs");
        String part = text(meta, "part");
        return new HairSuggestion(
                length,
                bangs,
                part,
                text(meta, "color"),
                text(meta, "rgb"),
                recommend(length, bangs, part).orElse(null));
    }

    private static String text(Map<?, ?> meta, String key) {
        return meta.get(key) instanceof String v ? v : null;
    }

    /** API-HAIR-02 검사. 없거나 노출하지 않는 템플릿이면 EDIT_010. */
    public void requireActive(String hairTemplateId) {
        if (hairTemplateRepository.findByIdAndActiveTrue(hairTemplateId).isEmpty()) {
            throw new BusinessException(EditErrorCode.HAIR_TEMPLATE_NOT_FOUND);
        }
    }

    /**
     * 추정 속성과 가장 닮은 템플릿. 바인딩이 없는 템플릿은 사용자 머리에 맞출 수 없어 고르지 않는다. 길이·앞머리 둘 다 모르면 추천하지 않는다.
     *
     * <p>점수: 길이 3점, 앞머리 2점(한 단계 차이는 절반), 가르마 1점(한쪽이 none·center면 절반). 같으면 sort_order가 앞선 것.
     */
    public Optional<String> recommend(String length, String bangs, String part) {
        // List.of는 null을 찾으면 NPE라 indexOf 전에 null을 거른다
        if (index(LENGTHS, length) < 0 && index(BANGS, bangs) < 0) {
            return Optional.empty();
        }
        return hairTemplateRepository.findAllByActiveTrueOrderBySortOrderAsc().stream()
                .filter(t -> t.getBindingObjectKey() != null)
                .max(
                        Comparator.comparingDouble(
                                        (HairTemplate t) -> score(t, length, bangs, part))
                                .thenComparing(
                                        HairTemplate::getSortOrder, Comparator.reverseOrder()))
                .map(HairTemplate::getId);
    }

    static double score(HairTemplate t, String length, String bangs, String part) {
        return 3.0 * ordinal(LENGTHS, length, t.getLength())
                + 2.0 * ordinal(BANGS, bangs, t.getBangs())
                + partScore(part, t.getPart());
    }

    private static double ordinal(List<String> order, String want, String have) {
        int a = index(order, want);
        int b = index(order, have);
        if (a < 0 || b < 0) {
            return 0;
        }
        int d = Math.abs(a - b);
        return d == 0 ? 1.0 : d == 1 ? 0.5 : 0.0;
    }

    private static int index(List<String> order, String value) {
        return value == null ? -1 : order.indexOf(value);
    }

    private static double partScore(String want, String have) {
        if (want == null || have == null) {
            return 0;
        }
        if (want.equals(have)) {
            return 1.0;
        }
        return List.of(want, have).stream().anyMatch(p -> p.equals("none") || p.equals("center"))
                ? 0.5
                : 0.0;
    }

    private String url(String objectKey) {
        return objectKey == null ? null : storage.presignGet(objectKey).url();
    }
}
