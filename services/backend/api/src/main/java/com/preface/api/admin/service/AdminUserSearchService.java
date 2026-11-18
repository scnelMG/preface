package com.preface.api.admin.service;

import com.preface.api.admin.dto.AdminPage;
import com.preface.api.admin.dto.AdminUserListItem;
import com.preface.common.admin.entity.AdminAccessTargetType;
import com.preface.common.admin.repository.AdminUserSearchRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.user.entity.OAuthProvider;
import com.preface.common.user.entity.User;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 관리자 회원 목록·검색(S15P31B204-707). 권한 확인은 보안 필터가 이미 마쳤다.
 *
 * <p>검색어 {@code q}(앞뒤 공백 제거): 비면 전체, UUID 형식이면 userId 일치 1건(탈퇴 회원 포함), 그 밖은 닉네임 부분 일치(대소문자 무시).
 * 이메일은 검색하지도 내리지도 않는다.
 *
 * <p>요청마다 조회 기록(USER)을 한 건 남긴다. 검색어는 기록하지 않는다. userId로 한 명을 찾았을 때만 대상 회원·대상 ID에 그 회원을 넣는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AdminUserSearchService {

    static final int DEFAULT_SIZE = 20;
    static final int MAX_SIZE = 100;
    static final int MAX_QUERY_LENGTH = 50;

    private static final Pattern UUID =
            Pattern.compile(
                    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    private final AdminUserSearchRepository repository;
    private final AdminAccessLogger accessLogger;

    public AdminPage<AdminUserListItem> search(
            String adminUserId, String q, Integer page, Integer size, String requestPath) {
        int safePage = page == null ? 0 : page;
        int safeSize = size == null ? DEFAULT_SIZE : Math.min(size, MAX_SIZE);
        if (safePage < 0 || safeSize < 1) {
            throw invalid("page must be >= 0 and size >= 1");
        }
        String query = q == null ? "" : q.strip();
        if (query.length() > MAX_QUERY_LENGTH) {
            throw invalid("q must be <= " + MAX_QUERY_LENGTH + " chars");
        }

        if (isUuid(query)) {
            Optional<User> found = repository.findById(query.toLowerCase(Locale.ROOT));
            String foundId = found.map(User::getId).orElse(null);
            List<User> users =
                    found.isPresent() && safePage == 0 ? List.of(found.get()) : List.of();
            List<AdminUserListItem> items = toItems(users);
            accessLogger.record(
                    adminUserId, foundId, AdminAccessTargetType.USER, foundId, requestPath);
            return AdminPage.of(items, safePage, safeSize, found.isPresent() ? 1 : 0);
        }

        PageRequest pageable = PageRequest.of(safePage, safeSize);
        Page<User> result =
                query.isEmpty()
                        ? repository.findAllLatest(pageable)
                        : repository.searchByNickname(likePattern(query), pageable);
        List<AdminUserListItem> items = toItems(result.getContent());
        accessLogger.record(adminUserId, null, AdminAccessTargetType.USER, null, requestPath);
        return AdminPage.of(items, safePage, safeSize, result.getTotalElements());
    }

    static boolean isUuid(String value) {
        return UUID.matcher(value).matches();
    }

    /** 소문자로 바꾸고 LIKE 특수 문자({@code %}·{@code _})와 이스케이프 문자를 이스케이프해 앞뒤에 {@code %}를 붙인다. */
    static String likePattern(String query) {
        char escape = AdminUserSearchRepository.LIKE_ESCAPE;
        StringBuilder sb = new StringBuilder(query.length() + 8).append('%');
        for (char c : query.toLowerCase(Locale.ROOT).toCharArray()) {
            if (c == '%' || c == '_' || c == escape) {
                sb.append(escape);
            }
            sb.append(c);
        }
        return sb.append('%').toString();
    }

    /** 한 페이지 회원의 제공자·3D 수·마지막 작업 시각을 묶음 쿼리 세 번으로 붙인다. */
    private List<AdminUserListItem> toItems(List<User> users) {
        if (users.isEmpty()) {
            return List.of();
        }
        List<String> ids = users.stream().map(User::getId).toList();

        Map<String, TreeSet<String>> providers = new HashMap<>();
        for (Object[] row : repository.findProvidersByUserIds(ids)) {
            providers
                    .computeIfAbsent((String) row[0], k -> new TreeSet<>())
                    .add(((OAuthProvider) row[1]).name());
        }
        Map<String, Long> modelCounts = new HashMap<>();
        for (Object[] row : repository.countFaceModelsByUserIds(ids)) {
            modelCounts.put((String) row[0], ((Number) row[1]).longValue());
        }
        Map<String, Instant> lastJobAt = new HashMap<>();
        for (Object[] row : repository.findLastJobAtByUserIds(ids)) {
            lastJobAt.put((String) row[0], (Instant) row[1]);
        }

        return users.stream()
                .map(
                        u ->
                                new AdminUserListItem(
                                        u.getId(),
                                        u.getNickname(),
                                        List.copyOf(
                                                providers.getOrDefault(u.getId(), new TreeSet<>())),
                                        u.getRole() == null ? null : u.getRole().name(),
                                        u.getStatus() == null ? null : u.getStatus().name(),
                                        u.getCreatedAt(),
                                        u.getDeletedAt(),
                                        modelCounts.getOrDefault(u.getId(), 0L),
                                        lastJobAt.get(u.getId())))
                .toList();
    }

    private static BusinessException invalid(String detail) {
        return new BusinessException(CommonErrorCode.INVALID_REQUEST, detail);
    }
}
