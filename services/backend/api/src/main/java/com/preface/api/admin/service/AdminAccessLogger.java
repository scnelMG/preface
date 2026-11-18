package com.preface.api.admin.service;

import com.preface.common.admin.entity.AdminAccessLog;
import com.preface.common.admin.entity.AdminAccessTargetType;
import com.preface.common.admin.repository.AdminAccessLogRepository;
import java.time.Clock;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 관리자 조회 기록(REQ-N-27). 회원 데이터를 보여 주는 관리자 API가 응답 전에 부른다.
 *
 * <p>새 트랜잭션으로 바로 저장한다. 부르는 쪽이 읽기 전용 트랜잭션이어도 기록이 남고, 부르는 쪽이 나중에 실패해도 "봤다"는 기록은 지우지 않는다.
 *
 * <p>요청 경로는 쿼리 문자열을 떼고 남긴다(검색 조건에 섞일 수 있는 값을 남기지 않는다). 서명 URL은 넘기지 않는다.
 */
@Service
@RequiredArgsConstructor
public class AdminAccessLogger {

    static final int PATH_MAX = 255;

    private final AdminAccessLogRepository repository;
    private final Clock clock;

    /**
     * @param adminUserId 조회한 관리자(토큰의 subject)
     * @param targetUserId 조회 대상 회원. 특정 회원이 아니면 {@code null}
     * @param targetType 대상 종류
     * @param targetId 대상 ID(작업·3D 등). 목록 조회면 {@code null}
     * @param requestPath 요청 경로({@code request.getRequestURI()})
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(
            String adminUserId,
            String targetUserId,
            AdminAccessTargetType targetType,
            String targetId,
            String requestPath) {
        repository.save(
                AdminAccessLog.of(
                        adminUserId,
                        targetUserId,
                        targetType,
                        targetId,
                        sanitize(requestPath),
                        clock.instant()));
    }

    static String sanitize(String requestPath) {
        if (requestPath == null || requestPath.isBlank()) {
            return "/";
        }
        int query = requestPath.indexOf('?');
        String path = query < 0 ? requestPath : requestPath.substring(0, query);
        return path.length() <= PATH_MAX ? path : path.substring(0, PATH_MAX);
    }
}
