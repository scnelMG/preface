package com.preface.api.reconstruction.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 3D 복원 설정({@code preface.reconstruction.*}). 값의 근거는 {@code contracts/reconstruction/README.md}.
 *
 * @param morphSchemaVersion 새 메시가 지원해야 하는 morph 스키마 버전
 * @param pollInterval FE 상태 조회 간격(API-REC-01 응답 {@code pollIntervalMs})
 * @param heartbeatInterval 워커 진행 보고 간격 [가정]
 * @param leaseTimeout 마지막 claim·진행 보고 뒤 회수까지 [가정]
 * @param maxAttempts 회수 포함 최대 시도 수. 넘으면 FAILED(TIMEOUT) (명세 "1회 재큐잉" → 2)
 * @param recentFailureWindow API-REC-03 "최근 실패" 기준
 * @param failedUploadRetention 실패·취소 작업의 원본 영상 보관 시간(종료 + 24h)
 * @param maxFrames 추출 워커가 올릴 수 있는 프레임 최대 장 수(S15P31B204-353, 1~이 값)
 * @param extractLeaseTimeout 추출 워커가 가져간 뒤 결과가 없으면 다른 워커가 다시 가져갈 수 있게 되기까지
 * @param extractMaxAttempts 추출 최대 시도 수. 넘으면 FAILED(TIMEOUT)
 */
@ConfigurationProperties("preface.reconstruction")
public record ReconstructionProperties(
        String morphSchemaVersion,
        Duration pollInterval,
        Duration heartbeatInterval,
        Duration leaseTimeout,
        int maxAttempts,
        Duration recentFailureWindow,
        Duration failedUploadRetention,
        int maxFrames,
        Duration extractLeaseTimeout,
        int extractMaxAttempts) {

    public ReconstructionProperties {
        morphSchemaVersion = morphSchemaVersion == null ? "v1" : morphSchemaVersion;
        pollInterval = pollInterval == null ? Duration.ofSeconds(3) : pollInterval;
        heartbeatInterval = heartbeatInterval == null ? Duration.ofSeconds(120) : heartbeatInterval;
        leaseTimeout = leaseTimeout == null ? Duration.ofSeconds(600) : leaseTimeout;
        maxAttempts = maxAttempts <= 0 ? 2 : maxAttempts;
        recentFailureWindow =
                recentFailureWindow == null ? Duration.ofHours(24) : recentFailureWindow;
        failedUploadRetention =
                failedUploadRetention == null ? Duration.ofHours(24) : failedUploadRetention;
        maxFrames = maxFrames <= 0 ? 100 : maxFrames;
        extractLeaseTimeout =
                extractLeaseTimeout == null ? Duration.ofSeconds(600) : extractLeaseTimeout;
        extractMaxAttempts = extractMaxAttempts <= 0 ? 2 : extractMaxAttempts;
    }
}
