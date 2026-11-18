package com.preface;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 작업 관리자 진입점. api와 따로 도는 스케줄 작업을 맡는다.
 *
 * <ul>
 *   <li>3D 복원 lease 회수(1분, {@code jobmanager.reconstruction})
 *   <li>데이터 자동 삭제(매시간, {@code jobmanager.deletion})
 * </ul>
 *
 * <p>api와 같은 이미지에서 별도 프로세스로 실행한다. 엔티티·저장소는 {@code common} 모듈을 함께 쓴다. 여러 인스턴스가 떠도 각 작업은 Redis 락으로 한
 * 곳에서만 돈다.
 */
@SpringBootApplication
public class JobManagerApplication {

    public static void main(String[] args) {
        SpringApplication.run(JobManagerApplication.class, args);
    }
}
