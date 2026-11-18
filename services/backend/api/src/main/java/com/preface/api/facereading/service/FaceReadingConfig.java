package com.preface.api.facereading.service;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * AI 관상 비동기 처리. GMS 이미지 호출은 수십 초 걸릴 수 있어 요청 스레드·트랜잭션 밖의 작은 전용 풀에서 돌린다.
 *
 * <p>동시에 2건, 대기 20건. 넘치면 그 요청은 {@code BUSY}로 실패하고 사용자는 다시 시도한다. 서버가 재시작되면 대기 중이던 작업은 사라지고, PENDING이
 * {@code stallAfter}보다 오래되면 다시 요청할 수 있다({@link FaceReadingService}).
 */
@Configuration
@EnableConfigurationProperties(FaceReadingProperties.class)
class FaceReadingConfig {

    @Bean(name = "faceReadingExecutor", destroyMethod = "shutdown")
    ThreadPoolTaskExecutor faceReadingExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(20);
        executor.setThreadNamePrefix("face-reading-");
        executor.initialize();
        return executor;
    }
}
