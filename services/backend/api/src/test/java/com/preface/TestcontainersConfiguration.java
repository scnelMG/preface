package com.preface;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 로컬 통합 테스트용 MySQL·Redis 컨테이너.
 *
 * <p>CI(be:it)는 Testcontainers 대신 GitLab {@code services:}를 쓴다(Runner에 privileged 권한을 주지 않기 위해).
 * 그때는 환경 변수 {@code PREFACE_IT_TESTCONTAINERS=false}로 끄고 {@code DB_URL} 등으로 서비스에 붙는다.
 *
 * <p>이미지 버전은 운영과 같은 메이저로 고정한다(latest 금지).
 */
@TestConfiguration(proxyBeanMethods = false)
@ConditionalOnProperty(
        name = "preface.it.testcontainers",
        havingValue = "true",
        matchIfMissing = true)
public class TestcontainersConfiguration {

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
