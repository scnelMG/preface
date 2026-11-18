package com.preface.api.simulation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.hair.service.HairTemplateService;
import com.preface.api.simulation.dto.SimulationHairResponse;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.EditErrorCode;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.SimulationRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class SimulationHairServiceTest {

    private static final String USER = "user-1";
    private static final String SIM = "sim-1";

    private final SimulationRepository repository = mock(SimulationRepository.class);
    private final HairTemplateService hairTemplates = mock(HairTemplateService.class);
    private SimulationHairService service;
    private Simulation simulation;

    @BeforeEach
    void setUp() {
        service = new SimulationHairService(repository, hairTemplates);
        simulation = Simulation.create(USER, "model-1", "2026.11.03 시안", "{}");
        ReflectionTestUtils.setField(simulation, "id", SIM);
        ReflectionTestUtils.setField(simulation, "stateVersion", 4);
        when(repository.findOwnedForUpdate(SIM, USER)).thenReturn(Optional.of(simulation));
    }

    @Test
    void 헤어를_적용하면_시안에_저장되고_가중치_버전은_그대로다() {
        SimulationHairResponse res = service.apply(USER, SIM, "short-bangs");

        assertThat(res.hairTemplateId()).isEqualTo("short-bangs");
        assertThat(simulation.getHairTemplateId()).isEqualTo("short-bangs");
        assertThat(simulation.getStateVersion()).isEqualTo(4);
        assertThat(simulation.getMorphState()).isEqualTo("{}");
        assertThat(simulation.isHasChanges()).isTrue();
    }

    @Test
    void null이면_헤어를_해제하고_템플릿을_확인하지_않는다() {
        ReflectionTestUtils.setField(simulation, "hairTemplateId", "short-bangs");

        SimulationHairResponse res = service.apply(USER, SIM, null);

        assertThat(res.hairTemplateId()).isNull();
        verify(hairTemplates, never()).requireActive(anyString());
    }

    @Test
    void 없는_템플릿이면_EDIT_010이고_시안은_바뀌지_않는다() {
        doThrow(new BusinessException(EditErrorCode.HAIR_TEMPLATE_NOT_FOUND))
                .when(hairTemplates)
                .requireActive("gone");

        assertThatThrownBy(() -> service.apply(USER, SIM, "gone"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(EditErrorCode.HAIR_TEMPLATE_NOT_FOUND);
        assertThat(simulation.getHairTemplateId()).isNull();
        assertThat(simulation.isHasChanges()).isFalse();
    }

    @Test
    void 남의_시안이면_COMMON_002다() {
        when(repository.findOwnedForUpdate(SIM, "other")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.apply("other", SIM, "short-bangs"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(CommonErrorCode.NOT_FOUND);
    }
}
