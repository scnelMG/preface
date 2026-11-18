package com.preface;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Spring Boot API 진입점.
 *
 * <p>이 클래스를 {@code com.preface}에 두는 이유: 컴포넌트·엔티티·JPA 저장소 스캔이 이 패키지부터 시작하므로 {@code common} 모듈의
 * {@code com.preface.common..}(엔티티·저장소)까지 별도 설정 없이 잡힌다.
 */
@SpringBootApplication
public class ApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(ApiApplication.class, args);
    }
}
