package com.preface.jobmanager.deletion.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 자동 삭제 설정({@code preface.deletion.*}). 실행 주기는 {@code preface.deletion.cron}(기본 매시 정각, UTC).
 *
 * @param emptySimulationTtl 빈 시안 보관 시간(FN-HIS-05: 생성 + 24h)
 * @param softDeleteRetention 소프트 삭제 뒤 물리 삭제까지(FN-HIS-03: 30일)
 * @param batchSize 한 트랜잭션에서 처리할 행 수
 * @param maxRetries S3 삭제 실패 허용 횟수. 이만큼 실패하면 {@code FAILED}(운영 확인 대상)
 * @param lockTtl 중복 실행 방지 락 TTL. 한 번 실행보다 길고 주기(1시간)보다 짧게
 * @param notificationRetention 알림 보관(생성 + 90일, 조회 API의 숨김 기준과 같게)
 * @param withdrawnRecordRetention 탈퇴 회원의 동의·삭제 기록 분리 보관(탈퇴 + 1년, 동의서·처리방침 본문)
 */
@ConfigurationProperties("preface.deletion")
public record DeletionProperties(
        Duration emptySimulationTtl,
        Duration softDeleteRetention,
        int batchSize,
        int maxRetries,
        Duration lockTtl,
        Duration notificationRetention,
        Duration withdrawnRecordRetention) {

    public DeletionProperties {
        emptySimulationTtl = emptySimulationTtl == null ? Duration.ofHours(24) : emptySimulationTtl;
        softDeleteRetention =
                softDeleteRetention == null ? Duration.ofDays(30) : softDeleteRetention;
        batchSize = batchSize <= 0 ? 100 : batchSize;
        maxRetries = maxRetries <= 0 ? 5 : maxRetries;
        lockTtl = lockTtl == null ? Duration.ofMinutes(30) : lockTtl;
        notificationRetention =
                notificationRetention == null ? Duration.ofDays(90) : notificationRetention;
        withdrawnRecordRetention =
                withdrawnRecordRetention == null ? Duration.ofDays(365) : withdrawnRecordRetention;
    }
}
