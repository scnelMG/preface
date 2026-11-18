package com.preface.api.user.service;

import com.preface.api.user.dto.MeResponse;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.SocialAccountRepository;
import com.preface.common.user.repository.UserRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserQueryService {

    private final UserRepository userRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final JdbcTemplate jdbcTemplate;

    /** API-AUTH-05. 탈퇴했거나 없는 회원의 토큰이면 AUTH_001. */
    public MeResponse me(String userId) {
        User user =
                userRepository
                        .findById(userId)
                        .filter(User::isActive)
                        .orElseThrow(() -> new BusinessException(AuthErrorCode.UNAUTHORIZED));
        List<String> providers =
                socialAccountRepository.findAllByUserId(userId).stream()
                        .map(a -> a.getProvider().name())
                        .sorted()
                        .toList();
        // face_model·simulation 엔티티는 각 기능 스토리에서 만든다. 그 전까지 개수만 SQL로 센다.
        long faceModels =
                count(
                        "select count(*) from face_model where user_id = ? and deleted_at is null",
                        userId);
        long simulations =
                count(
                        "select count(*) from simulation"
                                + " where user_id = ? and deleted_at is null and has_changes = 1",
                        userId);
        return new MeResponse(
                user.getId(),
                user.getNickname(),
                EmailMasker.mask(user.getEmail()),
                providers,
                user.getCreatedAt(),
                List.of(),
                new MeResponse.DataSummary(faceModels, simulations),
                user.getMattermostUsername());
    }

    private long count(String sql, String userId) {
        Long result = jdbcTemplate.queryForObject(sql, Long.class, userId);
        return result == null ? 0 : result;
    }
}
