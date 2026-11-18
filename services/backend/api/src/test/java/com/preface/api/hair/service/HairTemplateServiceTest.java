package com.preface.api.hair.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.preface.api.hair.dto.HairSuggestion;
import com.preface.api.hair.dto.HairTemplateListResponse;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.reconstruction.service.ReconstructionStorage.PresignedUrl;
import com.preface.common.error.BusinessException;
import com.preface.common.error.EditErrorCode;
import com.preface.common.hair.entity.HairTemplate;
import com.preface.common.hair.repository.HairTemplateRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class HairTemplateServiceTest {

    private static final Instant EXPIRES = Instant.parse("2026-11-03T01:10:00Z");

    private final HairTemplateRepository repository = mock(HairTemplateRepository.class);
    private final ReconstructionStorage storage = mock(ReconstructionStorage.class);
    private HairTemplateService service;

    @BeforeEach
    void setUp() {
        service = new HairTemplateService(repository, storage, JsonMapper.builder().build());
        when(storage.presignGet(anyString()))
                .thenAnswer(
                        inv ->
                                new PresignedUrl(
                                        "https://signed/" + inv.getArgument(0), Map.of(), EXPIRES));
    }

    private static HairTemplate tpl(
            String id, String length, String bangs, String part, boolean bound, int order) {
        return HairTemplate.of(
                id,
                id,
                "hair/" + id + "/hair.glb",
                bound ? "hair/" + id + "/binding.bin" : null,
                "gnm-v3",
                length,
                bangs,
                part,
                "#3a2a20",
                order);
    }

    @Test
    void 목록은_메시_바인딩_썸네일을_서명하고_없는_파일은_null로_둔다() {
        when(repository.findAllByActiveTrueOrderBySortOrderAsc())
                .thenReturn(
                        List.of(
                                tpl("short-bangs", "short", "full", "none", true, 1),
                                tpl("long-center", "long", "none", "center", false, 2)));

        HairTemplateListResponse res = service.list();

        assertThat(res.templates()).hasSize(2);
        assertThat(res.templates().get(0).meshUrl())
                .isEqualTo("https://signed/hair/short-bangs/hair.glb");
        assertThat(res.templates().get(0).bindingUrl())
                .isEqualTo("https://signed/hair/short-bangs/binding.bin");
        assertThat(res.templates().get(1).bindingUrl()).isNull();
        assertThat(res.templates().get(0).thumbnailUrl()).isNull();
        assertThat(res.urlExpiresAt()).isEqualTo(EXPIRES);
        assertThat(res.templates().get(0).toString()).doesNotContain("https://");
    }

    @Test
    void 템플릿_하나는_노출_중일_때만_서명해_준다() {
        when(repository.findByIdAndActiveTrue("short-bangs"))
                .thenReturn(Optional.of(tpl("short-bangs", "short", "full", "none", true, 1)));
        when(repository.findByIdAndActiveTrue("hidden")).thenReturn(Optional.empty());

        assertThat(service.item("short-bangs"))
                .get()
                .extracting(HairTemplateListResponse.Item::bindingUrl)
                .isEqualTo("https://signed/hair/short-bangs/binding.bin");
        assertThat(service.item("hidden")).isEmpty();
    }

    @Test
    void 길이_앞머리_가르마가_모두_같은_템플릿을_추천한다() {
        when(repository.findAllByActiveTrueOrderBySortOrderAsc())
                .thenReturn(
                        List.of(
                                tpl("short-none", "short", "none", "none", true, 1),
                                tpl("short-bangs", "short", "full", "none", true, 2),
                                tpl("medium-bangs", "medium", "full", "none", true, 3)));

        assertThat(service.recommend("short", "full", "none")).contains("short-bangs");
    }

    @Test
    void 바인딩이_없는_템플릿은_점수가_높아도_추천하지_않는다() {
        when(repository.findAllByActiveTrueOrderBySortOrderAsc())
                .thenReturn(
                        List.of(
                                tpl("exact-unbound", "short", "full", "none", false, 1),
                                tpl("near", "medium", "full", "none", true, 2)));

        assertThat(service.recommend("short", "full", "none")).contains("near");
    }

    @Test
    void 점수가_같으면_sort_order가_앞선_템플릿을_추천한다() {
        when(repository.findAllByActiveTrueOrderBySortOrderAsc())
                .thenReturn(
                        List.of(
                                tpl("first", "short", "none", "left", true, 1),
                                tpl("second", "short", "none", "left", true, 2)));

        assertThat(service.recommend("short", "none", "left")).contains("first");
    }

    @Test
    void 길이와_앞머리를_모두_모르면_추천하지_않는다() {
        assertThat(service.recommend(null, null, "left")).isEmpty();
    }

    @Test
    void 저장된_머리_속성으로_상세_헤어_항목과_추천을_만든다() {
        when(repository.findAllByActiveTrueOrderBySortOrderAsc())
                .thenReturn(List.of(tpl("short-bangs", "short", "full", "none", true, 1)));

        HairSuggestion s =
                service.suggest(
                        "{\"schemaVersion\":\"v1\",\"length\":\"short\",\"bangs\":\"full\","
                                + "\"part\":\"none\",\"color\":\"brown\",\"rgb\":\"#341f1d\"}");

        assertThat(s)
                .isEqualTo(
                        new HairSuggestion(
                                "short", "full", "none", "brown", "#341f1d", "short-bangs"));
    }

    @Test
    void 머리_속성이_없거나_읽을_수_없으면_헤어_항목은_null이다() {
        assertThat(service.suggest(null)).isNull();
        assertThat(service.suggest("not json")).isNull();
    }

    @Test
    void 없거나_노출하지_않는_템플릿이면_EDIT_010이다() {
        when(repository.findByIdAndActiveTrue("gone")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.requireActive("gone"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(EditErrorCode.HAIR_TEMPLATE_NOT_FOUND);
    }
}
