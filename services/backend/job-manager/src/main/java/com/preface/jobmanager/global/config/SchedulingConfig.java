package com.preface.jobmanager.global.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 스케줄 작업(자동 삭제·lease 회수) 공통 설정. 여러 인스턴스가 떠도 한 번만 돌도록 각 작업은 {@code RedisJobLock}을 잡고 실행한다. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
class SchedulingConfig {

    /** 테스트에서 시간을 고정하려고 빈으로 둔다. */
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}
