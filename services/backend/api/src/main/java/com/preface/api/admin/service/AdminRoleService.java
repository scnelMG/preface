package com.preface.api.admin.service;

import com.preface.api.global.security.AdminRoleLookup;
import com.preface.common.user.entity.UserRole;
import com.preface.common.user.entity.UserStatus;
import com.preface.common.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 관리자 여부를 DB에서 읽는다. 보안 필터({@code AdminAuthorization})가 관리자 API 요청마다 부른다. */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AdminRoleService implements AdminRoleLookup {

    private final UserRepository userRepository;

    @Override
    public boolean isActiveAdmin(String userId) {
        return userRepository.existsByIdAndStatusAndRole(userId, UserStatus.ACTIVE, UserRole.ADMIN);
    }
}
