package com.preface.api.admin.dto;

import java.time.Instant;
import java.util.List;

/**
 * 관리자 회원 목록 한 줄(S15P31B204-707). 이메일·Mattermost 아이디는 넣지 않는다.
 *
 * @param nickname 탈퇴 회원이면 {@code null}
 * @param providers 연결된 소셜 제공자(KAKAO·GOOGLE), 이름순
 * @param role {@code user.role} 값 그대로
 * @param status {@code user.status} 값 그대로
 * @param faceModelCount 3D 수(소프트 삭제된 3D 포함)
 * @param lastJobAt 마지막 복원 작업 생성 시각. 작업이 없으면 {@code null}
 */
public record AdminUserListItem(
        String userId,
        String nickname,
        List<String> providers,
        String role,
        String status,
        Instant createdAt,
        Instant deletedAt,
        long faceModelCount,
        Instant lastJobAt) {}
