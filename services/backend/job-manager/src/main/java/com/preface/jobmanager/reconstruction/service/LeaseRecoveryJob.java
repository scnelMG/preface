package com.preface.jobmanager.reconstruction.service;

import com.preface.jobmanager.global.lock.RedisJobLock;
import java.time.Duration;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * lease 회수 스케줄러. 주기 60초(설정 {@code preface.reconstruction.lease-recovery-interval}). 같은 주기에 GPU 대기열
 * 시간 초과(S15P31B204-528)도 처리한다 — 둘 다 작업 행을 잠그고 같은 대기열 key를 고쳐서, 한 잠금 아래 차례로 돌린다.
 *
 * <p>삭제(매시간)와 주기를 나눈 이유: lease 600초가 끝난 작업을 1시간 뒤에야 회수하면 사용자는 최대 70분을 기다린다(REQ-N-12 목표 5분). 60초면 회수
 * 지연이 lease의 1/10 이내이고, 한 번 실행은 처리 중 목록(= GPU 워커 수만큼) 훑기라 가볍다.
 */
@Component
@RequiredArgsConstructor
@EnableConfigurationProperties(LeaseProperties.class)
class LeaseRecoveryJob {

    static final String LOCK_KEY = "recon:lock:lease-recovery";

    /** 한 번 실행(수 초)보다 길고, 주기(60초)의 몇 배 안쪽. 인스턴스가 죽어도 5분 뒤 다른 인스턴스가 이어받는다. */
    static final Duration LOCK_TTL = Duration.ofMinutes(5);

    private final LeaseRecoveryService recovery;
    private final RedisJobLock lock;

    @Scheduled(
            fixedDelayString = "${preface.reconstruction.lease-recovery-interval:60s}",
            initialDelayString = "${preface.reconstruction.lease-recovery-interval:60s}")
    void scheduled() {
        lock.runExclusively(
                LOCK_KEY,
                LOCK_TTL,
                () -> {
                    recovery.recoverExpired();
                    recovery.timeOutUnclaimed();
                    // 추출 대기 시간 초과와 빠진 GPU 대기열 복구(S15P31B204-593). 끝낸 작업을 다시 넣지 않게 시간 초과 뒤에 맞춘다
                    recovery.timeOutExtraction();
                    recovery.restoreGpuQueue();
                });
    }
}
