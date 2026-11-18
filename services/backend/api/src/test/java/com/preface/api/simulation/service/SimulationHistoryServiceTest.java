package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.simulation.dto.SimulationListResponse;
import com.preface.common.error.BusinessException;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.json.JsonMapper;

/** 시안 목록·이름 바꾸기·삭제 규칙. DB는 mock. */
class SimulationHistoryServiceTest {

    private static final String USER = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    private static final String SIM = "5e6f7081-9cad-4e1f-8a2b-3c4d5e6f7081";
    private static final String MODEL = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
    private static final Instant NOW = Instant.parse("2026-10-23T03:00:00.700Z");

    private final SimulationRepository repository = mock(SimulationRepository.class);
    private final MorphParameterService parameters = mock(MorphParameterService.class);
    private SimulationHistoryService service;

    @BeforeEach
    void setUp() {
        service =
                new SimulationHistoryService(
                        repository,
                        parameters,
                        new MorphStateCodec(JsonMapper.builder().build()),
                        Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void 변경_있는_시안을_지우면_소프트_삭제된다() {
        Simulation simulation = simulation(true, "{\"schemaVersion\":\"v1\",\"weights\":{}}");
        when(repository.findOwnedForUpdate(SIM, USER)).thenReturn(Optional.of(simulation));

        service.delete(USER, SIM);

        assertThat(simulation.getDeletedAt()).isEqualTo(Instant.parse("2026-10-23T03:00:00Z"));
        verify(repository, never()).delete(any());
    }

    @Test
    void 빈_시안을_지우면_바로_물리_삭제된다() {
        Simulation simulation = simulation(false, "{\"schemaVersion\":\"v1\",\"weights\":{}}");
        when(repository.findOwnedForUpdate(SIM, USER)).thenReturn(Optional.of(simulation));

        service.delete(USER, SIM);

        verify(repository).delete(simulation);
        assertThat(simulation.getDeletedAt()).isNull();
    }

    @Test
    void 없거나_남의_것이거나_지운_시안은_삭제_이름바꾸기_모두_COMMON_002() {
        when(repository.findOwnedForUpdate(SIM, USER)).thenReturn(Optional.empty());

        assertCode(() -> service.delete(USER, SIM), "COMMON_002");
        assertCode(() -> service.rename(USER, SIM, "새 이름"), "COMMON_002");
    }

    @Test
    void 이름은_앞뒤_공백을_지워_저장하고_가중치와_버전은_그대로다() {
        Simulation simulation = simulation(true, "{\"schemaVersion\":\"v1\",\"weights\":{}}");
        ReflectionTestUtils.setField(simulation, "stateVersion", 3);
        when(repository.findOwnedForUpdate(SIM, USER)).thenReturn(Optional.of(simulation));

        assertThat(service.rename(USER, SIM, "  콧대를 조금 높인 시안 ").title()).isEqualTo("콧대를 조금 높인 시안");
        assertThat(simulation.getStateVersion()).isEqualTo(3);
        verify(repository).flush();
    }

    @Test
    void 공백뿐인_이름은_COMMON_001이고_조회하지_않는다() {
        assertCode(() -> service.rename(USER, SIM, "   "), "COMMON_001");
        verify(repository, never()).findOwnedForUpdate(any(), any());
    }

    @Test
    void 목록은_faceModelId가_있으면_그_3D만_찾고_변경_부위를_붙인다() {
        Simulation simulation =
                simulation(
                        true,
                        "{\"schemaVersion\":\"v1\",\"weights\":{\"nose.bridge_height\":0.2,"
                                + "\"eye.size\":0.0}}");
        when(repository.findByUserIdAndFaceModelIdAndHasChangesTrueAndDeletedAtIsNull(
                        eq(USER), eq(MODEL), any()))
                .thenReturn(new PageImpl<>(List.of(simulation), PageRequest.of(0, 20), 1));
        Map<String, ChangedParts.PartOf> parts = new LinkedHashMap<>();
        parts.put("nose.bridge_height", new ChangedParts.PartOf("NOSE", 0.0));
        parts.put("eye.size", new ChangedParts.PartOf("EYE", 0.0));
        when(parameters.partsByCode("v1")).thenReturn(parts);

        SimulationListResponse list = service.list(USER, MODEL, 0, 20);

        assertThat(list.items())
                .singleElement()
                .satisfies(
                        item -> {
                            assertThat(item.simulationId()).isEqualTo(SIM);
                            assertThat(item.faceModelId()).isEqualTo(MODEL);
                            assertThat(item.changedParts()).containsExactly("NOSE");
                        });
        verify(repository, never()).findByUserIdAndHasChangesTrueAndDeletedAtIsNull(any(), any());
    }

    private static Simulation simulation(boolean hasChanges, String morphState) {
        Simulation simulation = Simulation.create(USER, MODEL, "2026.10.23 시안", morphState);
        ReflectionTestUtils.setField(simulation, "id", SIM);
        ReflectionTestUtils.setField(simulation, "hasChanges", hasChanges);
        return simulation;
    }

    private static void assertCode(Runnable call, String code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        BusinessException.class,
                        e -> assertThat(e.errorCode().code()).isEqualTo(code));
    }
}
