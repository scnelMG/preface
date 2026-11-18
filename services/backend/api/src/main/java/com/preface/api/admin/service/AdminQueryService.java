package com.preface.api.admin.service;

import com.preface.api.admin.dto.AdminMeResponse;
import com.preface.common.user.entity.UserRole;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 관리자 본인 정보. 권한 확인은 보안 필터가 이미 마쳤다(ADMIN이 아니면 여기까지 오지 않는다). */
@Service
@RequiredArgsConstructor
public class AdminQueryService {

    private final AdminProperties properties;

    public AdminMeResponse me(String adminUserId) {
        return new AdminMeResponse(adminUserId, UserRole.ADMIN.name(), properties.environment());
    }
}
