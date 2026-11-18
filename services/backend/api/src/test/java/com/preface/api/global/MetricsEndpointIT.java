package com.preface.api.global;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.preface.TestcontainersConfiguration;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * EC2 모니터링(Prometheus)이 토큰 없이 지표를 읽을 수 있는지 확인한다(S15P31B204-454).
 *
 * <p>밖에서는 프록시가 /api/*만 내보내므로 이 경로는 docker 망 안에서만 닿는다.
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class MetricsEndpointIT {

    @Autowired MockMvc mockMvc;

    @Test
    void 토큰_없이_Prometheus_형식_지표를_읽는다() throws Exception {
        String body =
                mockMvc.perform(get("/actuator/prometheus"))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        assertThat(body).contains("jvm_memory_used_bytes").contains("process_cpu_usage");
    }

    @Test
    void 워커_수와_3D_작업_지표를_DB에서_읽어_낸다() throws Exception {
        String body =
                mockMvc.perform(get("/actuator/prometheus"))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        // S15P31B204-455. 값이 NaN이면 DB 조회가 실패한 것이다
        assertThat(body)
                .contains("preface_workers_alive{kind=\"gpu\",server=\"ssafy\"} 0.0")
                .contains("preface_reconstruction_jobs{state=\"gpu_queue\"}")
                .contains("preface_reconstruction_finished_last_hour{outcome=\"failed\"}")
                .contains("preface_reconstruction_fail_codes_last_hour{code=\"INTERNAL\"}");
        assertThat(body.lines().filter(line -> line.startsWith("preface_")))
                .isNotEmpty()
                .noneMatch(line -> line.endsWith("NaN"));
    }

    @Test
    void 다른_actuator_경로는_열지_않는다() throws Exception {
        mockMvc.perform(get("/actuator/env")).andExpect(status().is4xxClientError());
    }
}
