package com.preface.api.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.preface.api.admin.dto.AdminUserListItem;
import com.preface.common.admin.entity.AdminAccessTargetType;
import com.preface.common.admin.repository.AdminUserSearchRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.user.entity.OAuthProvider;
import com.preface.common.user.entity.User;
import com.preface.common.user.entity.UserRole;
import com.preface.common.user.entity.UserStatus;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

/** 관리자 회원 목록·검색 규칙(S15P31B204-707). DB는 mock, 값은 합성. */
class AdminUserSearchServiceTest {

    private static final String ADMIN = "00000000-0000-0000-0000-00000000000a";
    private static final String USER_A = "00000000-0000-0000-0000-000000000001";
    private static final String USER_B = "00000000-0000-0000-0000-000000000002";
    private static final String PATH = "/api/v1/admin/users";
    private static final Instant JOINED = Instant.parse("2026-11-01T03:00:00Z");
    private static final Instant LAST_JOB = Instant.parse("2026-11-09T01:36:02Z");

    private final AdminUserSearchRepository repository = mock(AdminUserSearchRepository.class);
    private final AdminAccessLogger accessLogger = mock(AdminAccessLogger.class);
    private final AdminUserSearchService service =
            new AdminUserSearchService(repository, accessLogger);

    @Test
    void 검색어가_비면_전체를_가입_최신순으로_주고_대상_없이_기록한다() {
        User a = user(USER_A, "합성A", UserStatus.ACTIVE);
        User b = user(USER_B, "합성B", UserStatus.ACTIVE);
        when(repository.findAllLatest(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(a, b), PageRequest.of(0, 20), 2));
        when(repository.findProvidersByUserIds(List.of(USER_A, USER_B)))
                .thenReturn(
                        rows(
                                new Object[] {USER_A, OAuthProvider.KAKAO},
                                new Object[] {USER_A, OAuthProvider.GOOGLE}));
        when(repository.countFaceModelsByUserIds(List.of(USER_A, USER_B)))
                .thenReturn(rows(new Object[] {USER_A, 3L}));
        when(repository.findLastJobAtByUserIds(List.of(USER_A, USER_B)))
                .thenReturn(rows(new Object[] {USER_A, LAST_JOB}));

        var page = service.search(ADMIN, "   ", null, null, PATH);

        assertThat(page.page()).isZero();
        assertThat(page.size()).isEqualTo(20);
        assertThat(page.totalElements()).isEqualTo(2);
        assertThat(page.totalPages()).isEqualTo(1);
        AdminUserListItem first = page.items().get(0);
        assertThat(first.userId()).isEqualTo(USER_A);
        assertThat(first.providers()).containsExactly("GOOGLE", "KAKAO");
        assertThat(first.faceModelCount()).isEqualTo(3);
        assertThat(first.lastJobAt()).isEqualTo(LAST_JOB);
        assertThat(first.role()).isEqualTo("USER");
        assertThat(first.status()).isEqualTo("ACTIVE");
        assertThat(first.createdAt()).isEqualTo(JOINED);
        AdminUserListItem second = page.items().get(1);
        assertThat(second.providers()).isEmpty();
        assertThat(second.faceModelCount()).isZero();
        assertThat(second.lastJobAt()).isNull();
        verify(repository, never()).searchByNickname(anyString(), any());
        verify(accessLogger).record(ADMIN, null, AdminAccessTargetType.USER, null, PATH);
    }

    @Test
    void UUID면_대소문자와_상관없이_탈퇴_회원도_찾고_그_회원을_대상으로_기록한다() {
        User withdrawn = user(USER_B, null, UserStatus.WITHDRAWN);
        when(withdrawn.getDeletedAt()).thenReturn(LAST_JOB);
        when(repository.findById(USER_B)).thenReturn(Optional.of(withdrawn));

        var page = service.search(ADMIN, " " + USER_B.toUpperCase() + " ", null, null, PATH);

        assertThat(page.totalElements()).isEqualTo(1);
        assertThat(page.items()).hasSize(1);
        assertThat(page.items().get(0).nickname()).isNull();
        assertThat(page.items().get(0).status()).isEqualTo("WITHDRAWN");
        assertThat(page.items().get(0).deletedAt()).isEqualTo(LAST_JOB);
        verify(repository, never()).findAllLatest(any());
        verify(repository, never()).searchByNickname(anyString(), any());
        verify(accessLogger).record(ADMIN, USER_B, AdminAccessTargetType.USER, USER_B, PATH);
    }

    @Test
    void UUID로_못_찾으면_빈_목록이고_대상_없이_기록한다() {
        when(repository.findById(USER_A)).thenReturn(Optional.empty());

        var page = service.search(ADMIN, USER_A, null, null, PATH);

        assertThat(page.items()).isEmpty();
        assertThat(page.totalElements()).isZero();
        assertThat(page.totalPages()).isZero();
        verify(repository, never()).findProvidersByUserIds(any());
        verify(accessLogger).record(ADMIN, null, AdminAccessTargetType.USER, null, PATH);
    }

    @Test
    void 이름_검색은_소문자로_바꾸고_LIKE_특수문자를_이스케이프한다() {
        when(repository.searchByNickname(anyString(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(1, 5), 0));

        service.search(ADMIN, " Ab%_!c ", 1, 5, PATH);

        verify(repository).searchByNickname("%ab!%!_!!c%", PageRequest.of(1, 5));
        verify(accessLogger).record(ADMIN, null, AdminAccessTargetType.USER, null, PATH);
    }

    @Test
    void UUID_형식이_아니면_이름_검색으로_간다() {
        assertThat(AdminUserSearchService.isUuid(USER_A)).isTrue();
        assertThat(AdminUserSearchService.isUuid(USER_A.toUpperCase())).isTrue();
        assertThat(AdminUserSearchService.isUuid("00000000-0000-0000-0000-00000000000")).isFalse();
        assertThat(AdminUserSearchService.isUuid("0000000000000000000000000000000000000"))
                .isFalse();
        assertThat(AdminUserSearchService.isUuid("합성")).isFalse();
    }

    @Test
    void 검색어가_50자를_넘으면_COMMON_001이고_조회하지도_기록하지도_않는다() {
        String tooLong = "가".repeat(51);

        assertThatThrownBy(() -> service.search(ADMIN, tooLong, null, null, PATH))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
        verifyNoInteractions(repository, accessLogger);
    }

    @Test
    void 앞뒤_공백을_뺀_50자는_받는다() {
        when(repository.searchByNickname(anyString(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 20), 0));

        service.search(ADMIN, "  " + "가".repeat(50) + "  ", null, null, PATH);

        verify(repository, times(1)).searchByNickname(anyString(), any(Pageable.class));
    }

    @Test
    void 쪽_번호가_음수이거나_크기가_1보다_작으면_COMMON_001이다() {
        assertThatThrownBy(() -> service.search(ADMIN, null, -1, null, PATH))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
        assertThatThrownBy(() -> service.search(ADMIN, null, 0, 0, PATH))
                .isInstanceOf(BusinessException.class)
                .extracting("errorCode")
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
        verifyNoInteractions(repository, accessLogger);
    }

    @Test
    void 크기는_100까지만_쓴다() {
        when(repository.findAllLatest(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 100), 0));

        var page = service.search(ADMIN, null, 0, 500, PATH);

        assertThat(page.size()).isEqualTo(100);
        verify(repository).findAllLatest(PageRequest.of(0, 100));
    }

    @Test
    void 응답_항목에는_이메일과_Mattermost_필드가_없다() {
        assertThat(
                        Arrays.stream(AdminUserListItem.class.getRecordComponents())
                                .map(c -> c.getName()))
                .containsExactly(
                        "userId",
                        "nickname",
                        "providers",
                        "role",
                        "status",
                        "createdAt",
                        "deletedAt",
                        "faceModelCount",
                        "lastJobAt");
    }

    private static User user(String id, String nickname, UserStatus status) {
        User user = mock(User.class);
        when(user.getId()).thenReturn(id);
        when(user.getNickname()).thenReturn(nickname);
        when(user.getEmail()).thenReturn("synthetic@example.test");
        when(user.getStatus()).thenReturn(status);
        when(user.getRole()).thenReturn(UserRole.USER);
        when(user.getCreatedAt()).thenReturn(JOINED);
        return user;
    }

    private static List<Object[]> rows(Object[]... rows) {
        return List.of(rows);
    }
}
