package com.preface.api.capture.service;

import com.preface.api.capture.dto.CaptureExchangeResponse;
import com.preface.api.capture.dto.CaptureLinkResponse;
import com.preface.api.capture.dto.CaptureLinkStatus;
import com.preface.api.capture.dto.CaptureLinkStatusResponse;
import com.preface.api.global.security.AuthPrincipal;
import com.preface.api.global.security.CaptureSessionRevocations;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenHashes;
import com.preface.api.global.security.TokenScope;
import com.preface.api.user.service.EmailMasker;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CaptureErrorCode;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * QR 휴대폰 연결(API-QR-01~04).
 *
 * <p>흐름: PC가 QR 발급 → 휴대폰이 토큰을 교환해 업로드 전용 세션(JWT {@code scope=capture}) 받음 → PC가 폴링으로 연결 확인 → 끊으면
 * 세션을 폐기 목록에 올려 즉시 무효.
 */
@Service
@RequiredArgsConstructor
public class CaptureLinkService {

    private final CaptureGuard captureGuard;
    private final CaptureLinkStore store;
    private final CaptureSessionRevocations revocations;
    private final CaptureProperties properties;
    private final JwtProvider jwtProvider;
    private final UserRepository userRepository;
    private final Clock clock;

    /** API-QR-01. 사용자당 유효 링크 1개: 이전 링크는 EXPIRED로 바꾸고 그 휴대폰 세션도 끊는다. */
    public CaptureLinkResponse create(String userId) {
        captureGuard.requireReady(userId);
        store.currentLinkIdOf(userId).flatMap(store::find).ifPresent(this::expireReplaced);

        String token = TokenHashes.newOpaqueToken();
        String linkId = UUID.randomUUID().toString();
        Instant expiresAt = clock.instant().plus(properties.linkTtl());
        store.create(
                linkId,
                userId,
                TokenHashes.sha256Hex(token),
                expiresAt,
                properties.linkTtl(),
                properties.sessionTtl());
        // fragment(#)는 브라우저가 서버로 보내지 않는다. 토큰이 서버·프록시 접근 로그에 남지 않는다(REQ-N-21)
        String qrUrl = properties.qrBaseUrl() + "/m/capture#t=" + token;
        return new CaptureLinkResponse(linkId, qrUrl, expiresAt);
    }

    /** API-QR-02. 인증 없이 부른다. 토큰은 1회용이다. */
    public CaptureExchangeResponse exchange(String token) {
        Instant sessionExpiresAt = clock.instant().plus(properties.sessionTtl());
        CaptureLinkStore.ExchangeResult result =
                store.exchange(
                        TokenHashes.sha256Hex(token), sessionExpiresAt, properties.sessionTtl());
        if (!result.connected()) {
            throw new BusinessException(
                    switch (result.status()) {
                        case CONNECTED, UPLOADED -> CaptureErrorCode.LINK_ALREADY_CONNECTED;
                        default -> CaptureErrorCode.LINK_EXPIRED;
                    });
        }
        User user =
                userRepository
                        .findById(result.userId())
                        .filter(User::isActive)
                        .orElseThrow(() -> new BusinessException(AuthErrorCode.UNAUTHORIZED));
        JwtProvider.IssuedToken session =
                jwtProvider.issueCapture(user.getId(), result.linkId(), properties.sessionTtl());
        return new CaptureExchangeResponse(
                session.value(),
                session.expiresInSeconds(),
                result.linkId(),
                new CaptureExchangeResponse.UserView(
                        user.getNickname(), EmailMasker.mask(user.getEmail())));
    }

    /** API-QR-03. 링크 주인(일반 세션)만. 없거나 남의 링크면 COMMON_002. */
    public CaptureLinkStatusResponse status(String userId, String linkId) {
        CaptureLinkStore.Link link =
                store.find(linkId)
                        .filter(l -> l.userId().equals(userId))
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        return new CaptureLinkStatusResponse(
                link.linkId(), link.status(), link.expiresAt(), link.jobId());
    }

    /**
     * API-QR-04. 링크 주인(일반 세션) 또는 그 링크로 받은 업로드 전용 세션만. 이미 끝난 링크여도 200(멱등). 이미 만든 복원 작업은 건드리지 않는다.
     */
    public Map<String, Object> cancel(AuthPrincipal principal, String linkId) {
        CaptureLinkStore.Link link =
                store.find(linkId)
                        .filter(l -> canCancel(principal, l))
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        store.transition(
                link.tokenHash(),
                CaptureLinkStatus.CANCELED,
                null,
                CaptureLinkStatus.WAITING,
                CaptureLinkStatus.CONNECTED,
                CaptureLinkStatus.UPLOADED);
        revocations.revoke(linkId, properties.sessionTtl());
        return Map.of();
    }

    /**
     * 업로드 전용 세션으로 복원 작업을 만들었을 때(API-REC-01) 그 링크를 UPLOADED·jobId로 바꾼다. PC 폴링이 이 jobId로 대기 화면에 간다.
     *
     * @return 링크가 CONNECTED였고 바뀌었으면 true
     */
    public boolean markUploaded(String linkId, String jobId) {
        return store.find(linkId)
                .map(
                        l ->
                                store.transition(
                                        l.tokenHash(),
                                        CaptureLinkStatus.UPLOADED,
                                        jobId,
                                        CaptureLinkStatus.CONNECTED))
                .orElse(false);
    }

    /** 업로드 전용 세션이 API-REC-02로 볼 수 있는 작업 ID. 링크가 UPLOADED가 아니면 비어 있다. */
    public Optional<String> uploadedJobId(String linkId) {
        return store.find(linkId)
                .filter(l -> l.status() == CaptureLinkStatus.UPLOADED)
                .map(CaptureLinkStore.Link::jobId);
    }

    private void expireReplaced(CaptureLinkStore.Link previous) {
        store.transition(
                previous.tokenHash(),
                CaptureLinkStatus.EXPIRED,
                null,
                CaptureLinkStatus.WAITING,
                CaptureLinkStatus.CONNECTED,
                CaptureLinkStatus.UPLOADED);
        revocations.revoke(previous.linkId(), properties.sessionTtl());
    }

    private static boolean canCancel(AuthPrincipal principal, CaptureLinkStore.Link link) {
        if (!link.userId().equals(principal.subject())) {
            return false;
        }
        return principal.scope() == TokenScope.USER
                || (principal.scope() == TokenScope.CAPTURE
                        && link.linkId().equals(principal.captureLinkId()));
    }
}
