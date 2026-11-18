package com.preface.api.notification.service;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * Mattermost 완료 알림(S15P31B204-476). DM은 작업을 끝내는 트랜잭션 밖의 작은 전용 풀에서 보낸다.
 *
 * <p>앱에 Executor 빈(관상 {@code faceReadingExecutor})이 있으면 Spring Boot가 기본 {@code
 * applicationTaskExecutor}를 만들지 않으므로 직접 둔다. 동시에 2건, 대기 100건. 넘치면 그 DM은 보내지 않는다(인앱 알림은 이미 저장됐다).
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MattermostProperties.class)
class MattermostConfig {

    @Bean(name = "mattermostExecutor", destroyMethod = "shutdown")
    ThreadPoolTaskExecutor mattermostExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("mattermost-");
        executor.initialize();
        return executor;
    }
}
