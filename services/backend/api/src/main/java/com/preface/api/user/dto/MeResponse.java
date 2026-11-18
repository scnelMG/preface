package com.preface.api.user.dto;

import java.time.Instant;
import java.util.List;

/**
 * API-AUTH-05 내 정보.
 *
 * @param reconsentRequired 재동의 정책 미결 — 1차는 항상 빈 목록
 * @param mattermostUsername 완료 알림을 받을 Mattermost 아이디(S15P31B204-476). 등록 전이면 null
 */
public record MeResponse(
        String id,
        String nickname,
        String maskedEmail,
        List<String> providers,
        Instant createdAt,
        List<String> reconsentRequired,
        DataSummary dataSummary,
        String mattermostUsername) {

    public record DataSummary(long faceModelCount, long simulationCount) {}
}
