package com.preface.api.admin.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 관리자 작업 화면({@code preface.admin.jobs.*}, S15P31B204-652).
 *
 * @param stuckThreshold 끝나지 않은 작업의 마지막 변경({@code updated_at})이 이보다 오래되면 "멈춤"으로 센다. 기본 15분
 * @param targetDuration 처리 시간 목표(REQ-N-12). 기본 5분
 */
@ConfigurationProperties("preface.admin.jobs")
public record AdminJobProperties(Duration stuckThreshold, Duration targetDuration) {

    public AdminJobProperties {
        stuckThreshold = stuckThreshold == null ? Duration.ofMinutes(15) : stuckThreshold;
        targetDuration = targetDuration == null ? Duration.ofMinutes(5) : targetDuration;
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AdminJobProperties.class)
    static class Config {}
}
