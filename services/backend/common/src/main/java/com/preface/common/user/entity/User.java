package com.preface.common.user.entity;

import com.preface.common.jpa.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

/** 회원. 동의 4종 저장이 성공한 뒤에만 만든다(REQ-F-01). */
@Getter
@Entity
@Table(name = "user")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User extends BaseTimeEntity {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(length = 50)
    private String nickname;

    private String email;

    /** 본인 확인을 마친 Mattermost 아이디(S15P31B204-476). 있으면 3D 생성 결과를 DM으로도 알린다 */
    @Column(length = 64)
    private String mattermostUsername;

    /** Mattermost 본인 확인·알림 동의 시각 */
    private Instant mattermostLinkedAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private UserStatus status;

    /** 권한(S15P31B204-651). ADMIN은 DB에서만 준다. 앱은 바꾸지 않고 읽기만 한다 */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private UserRole role;

    private Instant deletedAt;

    public static User join(String nickname, String email) {
        User user = new User();
        user.nickname = nickname;
        user.email = email;
        user.status = UserStatus.ACTIVE;
        user.role = UserRole.USER;
        return user;
    }

    /** 탈퇴(FN-AUTH-04). 개인정보(닉네임·이메일)를 비우고 식별자 행만 남긴다(동의 이력·삭제 기록의 감사 연결용). 되돌리지 않는다. */
    public void withdraw(Instant now) {
        nickname = null;
        email = null;
        unlinkMattermost();
        status = UserStatus.WITHDRAWN;
        deletedAt = now;
    }

    /** 확인 코드로 본인 확인을 마친 아이디를 등록한다. 이미 있으면 바꾼다. */
    public void linkMattermost(String username, Instant now) {
        mattermostUsername = username;
        mattermostLinkedAt = now;
    }

    /** Mattermost 알림을 끈다(아이디·동의 시각을 함께 지운다). */
    public void unlinkMattermost() {
        mattermostUsername = null;
        mattermostLinkedAt = null;
    }

    public boolean isActive() {
        return status == UserStatus.ACTIVE;
    }

    /** 관리자 API를 쓸 수 있는가. 탈퇴한 회원은 ADMIN이어도 아니다. */
    public boolean isActiveAdmin() {
        return isActive() && role == UserRole.ADMIN;
    }
}
