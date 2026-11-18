package com.preface.api.notification.service;

import com.preface.common.notification.entity.NotificationType;

/** 3D 생성 결과 알림을 저장했다. 커밋 뒤 Mattermost DM을 보내는 데 쓴다(S15P31B204-476). */
record ReconNotifiedEvent(String userId, NotificationType type, String targetId) {}
