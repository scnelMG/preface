package com.preface.jobmanager;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * job-manager 통합 테스트용 MySQL·Redis 컨테이너. api {@code TestcontainersConfiguration}과 같다(테스트 클래스는 모듈 사이에
 * 공유되지 않는다).
 *
 * <p>CI(be:it)는 {@code PREFACE_IT_TESTCONTAINERS=false}로 끄고 GitLab {@code services:}에 붙는다.
 */
@TestConfiguration(proxyBeanMethods = false)
@ConditionalOnProperty(
        name = "preface.it.testcontainers",
        havingValue = "true",
        matchIfMissing = true)
public class JobManagerTestcontainers {

    @Bean
    @ServiceConnection
    MySQLContainer mysqlContainer() {
        return new MySQLContainer(DockerImageName.parse("mysql:8.0"));
    }

    @Bean
    @ServiceConnection(name = "redis")
    GenericContainer<?> redisContainer() {
        return new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine"))
                .withExposedPorts(6379);
    }
}
