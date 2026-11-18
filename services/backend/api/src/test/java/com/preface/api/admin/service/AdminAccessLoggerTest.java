package com.preface.api.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.preface.common.admin.entity.AdminAccessLog;
import com.preface.common.admin.entity.AdminAccessTargetType;
import com.preface.common.admin.repository.AdminAccessLogRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class AdminAccessLoggerTest {

    private static final Instant NOW = Instant.parse("2026-11-07T03:12:45.123Z");
    private static final String ADMIN = "00000000-0000-0000-0000-00000000000a";
    private static final String TARGET = "00000000-0000-0000-0000-00000000000b";
    private static final String JOB = "00000000-0000-0000-0000-00000000000c";

    private final AdminAccessLogRepository repository = mock(AdminAccessLogRepository.class);
    private final AdminAccessLogger logger =
            new AdminAccessLogger(repository, Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void 조회한_관리자와_대상과_시각을_한_행으로_남긴다() {
        logger.record(
                ADMIN,
                TARGET,
                AdminAccessTargetType.JOB,
                JOB,
                "/api/v1/admin/reconstructions/" + JOB);

        AdminAccessLog saved = captureSaved();
        assertThat(saved.getAdminUserId()).isEqualTo(ADMIN);
        assertThat(saved.getTargetUserId()).isEqualTo(TARGET);
        assertThat(saved.getTargetType()).isEqualTo(AdminAccessTargetType.JOB);
        assertThat(saved.getTargetId()).isEqualTo(JOB);
        assertThat(saved.getRequestPath()).isEqualTo("/api/v1/admin/reconstructions/" + JOB);
        assertThat(saved.getAccessedAt()).isEqualTo(NOW);
    }

    @Test
    void 요청_경로의_쿼리_문자열은_남기지_않는다() {
        logger.record(
                ADMIN,
                TARGET,
                AdminAccessTargetType.JOB,
                null,
                "/api/v1/admin/reconstructions?userId=" + TARGET + "&status=FAILED");

        assertThat(captureSaved().getRequestPath()).isEqualTo("/api/v1/admin/reconstructions");
    }

    @Test
    void 긴_경로는_컬럼_길이에_맞춰_자르고_빈_경로는_슬래시로_남긴다() {
        assertThat(AdminAccessLogger.sanitize("/" + "a".repeat(400)))
                .hasSize(AdminAccessLogger.PATH_MAX);
        assertThat(AdminAccessLogger.sanitize(null)).isEqualTo("/");
        assertThat(AdminAccessLogger.sanitize(" ")).isEqualTo("/");
    }

    private AdminAccessLog captureSaved() {
        ArgumentCaptor<AdminAccessLog> captor = ArgumentCaptor.forClass(AdminAccessLog.class);
        verify(repository).save(captor.capture());
        return captor.getValue();
    }
}
