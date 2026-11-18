package com.preface.api.notification.service;

import com.preface.api.notification.dto.NotificationListResponse;
import com.preface.api.notification.dto.NotificationResponse;
import com.preface.api.notification.dto.ReadNotificationsRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.notification.entity.Notification;
import com.preface.common.notification.entity.NotificationType;
import com.preface.common.notification.repository.NotificationRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 인앱 알림(API-NOTI-01·02)과 알림 생성.
 *
 * <p>보관 기간([가정] 90일)이 지난 알림은 조회·개수·읽음 처리에서 뺀다. 물리 삭제 배치는 따로 만든다.
 */
@Service
@Transactional(readOnly = true)
public class NotificationService {

    static final int MAX_PAGE_SIZE = 50;

    private final NotificationRepository notificationRepository;
    private final Clock clock;
    private final Duration retention;
    private final ApplicationEventPublisher events;

    public NotificationService(
            NotificationRepository notificationRepository,
            Clock clock,
            ApplicationEventPublisher events,
            @Value("${preface.notification.retention:90d}") Duration retention) {
        this.notificationRepository = notificationRepository;
        this.clock = clock;
        this.retention = retention;
        this.events = events;
    }

    /** API-NOTI-01. 최신순(같은 시각이면 ID 내림차순). 조회만으로 읽음 처리하지 않는다. */
    public NotificationListResponse list(String userId, int page, int size) {
        int safePage = Math.max(page, 0);
        int safeSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
        Instant cutoff = cutoff();
        Page<Notification> result =
                notificationRepository.findByUserIdAndCreatedAtGreaterThanEqual(
                        userId,
                        cutoff,
                        PageRequest.of(
                                safePage,
                                safeSize,
                                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        List<NotificationResponse> items =
                result.getContent().stream().map(NotificationService::toResponse).toList();
        return new NotificationListResponse(
                items, safePage, safeSize, result.getTotalElements(), unreadCount(userId, cutoff));
    }

    /** API-NOTI-02. 남의 알림·없는 ID는 조용히 무시한다([가정]). */
    @Transactional
    public long markRead(String userId, ReadNotificationsRequest request) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        Instant cutoff = cutoff();
        if (request.readAll()) {
            notificationRepository.markAllRead(userId, now, cutoff);
        } else if (request.notificationIds() != null && !request.notificationIds().isEmpty()) {
            notificationRepository.markRead(userId, request.notificationIds(), now, cutoff);
        } else {
            throw new BusinessException(
                    CommonErrorCode.INVALID_REQUEST, "notificationIds or all=true required");
        }
        return unreadCount(userId, cutoff);
    }

    /** 3D 생성 성공 알림. 호출한 쪽 트랜잭션에 함께 들어간다. 커밋되면 Mattermost DM도 보낸다(S15P31B204-476). */
    @Transactional
    public void reconSucceeded(String userId, String faceModelId) {
        notificationRepository.save(
                Notification.of(userId, NotificationType.RECON_SUCCEEDED, faceModelId));
        events.publishEvent(
                new ReconNotifiedEvent(userId, NotificationType.RECON_SUCCEEDED, faceModelId));
    }

    /** 3D 생성 실패 알림. 이동 대상은 복원 작업(실패 안내 화면). */
    @Transactional
    public void reconFailed(String userId, String jobId) {
        notificationRepository.save(Notification.of(userId, NotificationType.RECON_FAILED, jobId));
        events.publishEvent(new ReconNotifiedEvent(userId, NotificationType.RECON_FAILED, jobId));
    }

    private long unreadCount(String userId, Instant cutoff) {
        return notificationRepository.countByUserIdAndReadAtIsNullAndCreatedAtGreaterThanEqual(
                userId, cutoff);
    }

    private Instant cutoff() {
        return clock.instant().minus(retention);
    }

    private static NotificationResponse toResponse(Notification n) {
        NotificationResponse.Target target =
                n.getTargetKind() == null
                        ? null
                        : new NotificationResponse.Target(
                                n.getTargetKind().name(), n.getTargetId());
        return new NotificationResponse(
                n.getId(),
                n.getType().name(),
                n.getTitle(),
                n.getBody(),
                target,
                n.getReadAt(),
                n.getCreatedAt());
    }
}
