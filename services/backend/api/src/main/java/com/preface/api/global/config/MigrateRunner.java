package com.preface.api.global.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * {@code migrate} 프로필 전용. Flyway migration만 실행하고 종료한다.
 *
 * <p>api와 job-manager는 같은 이미지라 앱 시작마다 Flyway를 돌리면 두 번 실행된다. 그래서 평소에는 {@code
 * spring.flyway.enabled=false}로 두고, 배포 때 이 프로필로 한 번만 실행한다(CI/CD 명세 "DB migration").
 */
@Slf4j
@Component
@Profile("migrate")
@RequiredArgsConstructor
public class MigrateRunner implements ApplicationRunner {

    private final ApplicationContext context;

    @Override
    public void run(ApplicationArguments args) {
        log.info("migration 완료, 종료한다");
        System.exit(SpringApplication.exit(context, () -> 0));
    }
}
