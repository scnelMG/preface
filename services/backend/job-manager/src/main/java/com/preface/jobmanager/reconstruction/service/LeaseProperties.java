package com.preface.jobmanager.reconstruction.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * lease 회수 설정({@code preface.reconstruction.*}). api의 같은 키(claim 응답 {@code leaseTimeoutSec})와 값이
 * 같아야 한다. 근거: {@code contracts/reconstruction/README.md} "상태와 회수 규칙".
 *
 * @param leaseTimeout 마지막 claim·진행 보고 뒤 회수까지 [가정 600초]
 * @param maxAttempts 회수 포함 최대 시도 수. 넘으면 FAILED(TIMEOUT) (명세 "1회 재큐잉" → 2)
 * @param failedUploadRetention 실패 작업의 원본 영상 보관 시간(종료 + 24h, FN-HIS-04)
 * @param leaseRecoveryInterval 회수 주기
 * @param queueTimeout 프레임 준비 뒤 GPU 대기열에서 아무도 가져가지 않을 때 FAILED(TIMEOUT)까지 [가정 20분, S15P31B204-528]
 * @param extractLeaseTimeout 추출 워커의 lease. api {@code extract-lease-timeout}과 같아야 한다 [가정 600초]
 * @param extractMaxAttempts 추출 최대 시도 수. api {@code extract-max-attempts}와 같아야 한다 [가정 2]
 * @param extractQueueTimeout 추출 대기(접수 또는 마지막 claim 뒤)에서 아무도 가져가지 않을 때 FAILED(TIMEOUT)까지 [가정 20분,
 *     S15P31B204-593]
 */
@ConfigurationProperties("preface.reconstruction")
public record LeaseProperties(
        Duration leaseTimeout,
        int maxAttempts,
        Duration failedUploadRetention,
        Duration leaseRecoveryInterval,
        Duration queueTimeout,
        Duration extractLeaseTimeout,
        int extractMaxAttempts,
        Duration extractQueueTimeout) {

    public LeaseProperties {
        leaseTimeout = leaseTimeout == null ? Duration.ofSeconds(600) : leaseTimeout;
        maxAttempts = maxAttempts <= 0 ? 2 : maxAttempts;
        failedUploadRetention =
                failedUploadRetention == null ? Duration.ofHours(24) : failedUploadRetention;
        leaseRecoveryInterval =
                leaseRecoveryInterval == null ? Duration.ofSeconds(60) : leaseRecoveryInterval;
        queueTimeout = queueTimeout == null ? Duration.ofMinutes(20) : queueTimeout;
        extractLeaseTimeout =
                extractLeaseTimeout == null ? Duration.ofSeconds(600) : extractLeaseTimeout;
        extractMaxAttempts = extractMaxAttempts <= 0 ? 2 : extractMaxAttempts;
        extractQueueTimeout =
                extractQueueTimeout == null ? Duration.ofMinutes(20) : extractQueueTimeout;
    }
}
