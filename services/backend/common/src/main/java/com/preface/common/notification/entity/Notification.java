package com.preface.common.notification.entity;

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

/** 인앱 알림. 3D 생성 성공·실패 때 결과 보고(INT-REC-03) 안에서 만든다. */
@Getter
@Entity
@Table(name = "notification")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Notification extends BaseTimeEntity {

    @Id
    @UuidGenerator
    @Column(length = 36)
    private String id;

    @Column(name = "user_id", nullable = false, length = 36, updatable = false)
    private String userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private NotificationType type;

    @Column(nullable = false, length = 100)
    private String title;

    @Column(length = 255)
    private String body;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private NotificationTargetKind targetKind;

    @Column(length = 36)
    private String targetId;

    private Instant readAt;

    public static Notification of(String userId, NotificationType type, String targetId) {
        Notification notification = new Notification();
        notification.userId = userId;
        notification.type = type;
        notification.title = type.title();
        notification.body = type.body();
        notification.targetKind = type.targetKind();
        notification.targetId = targetId;
        return notification;
    }
}
