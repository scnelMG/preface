package com.preface.api.notification.service;

import com.preface.api.notification.dto.MattermostCodeResponse;
import com.preface.api.notification.dto.MattermostLinkResponse;
import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.NotificationErrorCode;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.Locale;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Mattermost 아이디 등록(S15P31B204-476). 아이디로 6자리 코드를 DM으로 보내고, 코드가 맞아야 등록한다. 오타나 남의 아이디로 완료 알림이 가지 않게
 * 하려는 것이다. 이름·학번 같은 다른 정보는 받지 않는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MattermostLinkService {

    /** Mattermost 아이디 규칙: 소문자로 시작, 소문자·숫자·{@code . _ -}, 3~22자 */
    private static final Pattern USERNAME = Pattern.compile("^[a-z][a-z0-9._-]{2,21}$");

    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserRepository userRepository;
    private final MattermostVerificationStore store;
    private final MattermostWebhookClient webhook;
    private final MattermostProperties properties;
    private final Clock clock;

    /**
     * 확인 코드를 DM으로 보낸다. 같은 사람이 간격 안에 다시 받으면 COMMON_003. 외부 HTTP를 기다리는 동안 DB 연결을 잡지 않게 트랜잭션 밖에서 돈다.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public MattermostCodeResponse requestCode(String userId, String rawUsername) {
        if (!webhook.enabled()) {
            throw new BusinessException(NotificationErrorCode.MATTERMOST_DISABLED);
        }
        String username = normalize(rawUsername);
        activeUser(userId);
        if (!store.tryReserveSend(userId, properties.resendInterval())) {
            throw new BusinessException(CommonErrorCode.TOO_MANY_REQUESTS);
        }
        String code = "%06d".formatted(RANDOM.nextInt(1_000_000));
        MattermostWebhookClient.Result result = webhook.sendDirect(username, codeMessage(code));
        if (result != MattermostWebhookClient.Result.SENT) {
            // 보내지 못했으면 바로 다시 시도할 수 있게 간격 자리를 푼다
            store.releaseSend(userId);
            throw new BusinessException(
                    result == MattermostWebhookClient.Result.REJECTED
                            ? NotificationErrorCode.MATTERMOST_USER_NOT_FOUND
                            : CommonErrorCode.INTERNAL_ERROR,
                    "mattermost code send " + result);
        }
        store.save(userId, username, hash(code), properties.codeTtl());
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        return new MattermostCodeResponse(
                username, now.plus(properties.codeTtl()), now.plus(properties.resendInterval()));
    }

    /** 코드가 맞으면 아이디를 등록한다(= 알림 동의). 정해진 횟수를 넘게 틀리면 코드를 버린다. */
    @Transactional
    public MattermostLinkResponse confirm(String userId, String code) {
        User user = activeUser(userId);
        MattermostVerificationStore.Pending pending =
                store.find(userId)
                        .orElseThrow(
                                () ->
                                        new BusinessException(
                                                NotificationErrorCode.VERIFICATION_EXPIRED));
        if (code == null
                || !MessageDigest.isEqual(
                        hash(code.trim()).getBytes(StandardCharsets.UTF_8),
                        pending.codeHash().getBytes(StandardCharsets.UTF_8))) {
            if (store.incrementAttempts(userId) >= properties.maxAttempts()) {
                store.delete(userId);
                throw new BusinessException(NotificationErrorCode.VERIFICATION_EXPIRED);
            }
            throw new BusinessException(NotificationErrorCode.VERIFICATION_CODE_MISMATCH);
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        user.linkMattermost(pending.username(), now);
        store.delete(userId);
        return new MattermostLinkResponse(pending.username(), now);
    }

    /** 알림을 끈다. 등록이 없어도 성공(멱등). 확인 중인 코드도 버린다. */
    @Transactional
    public void unlink(String userId) {
        activeUser(userId).unlinkMattermost();
        store.delete(userId);
    }

    /** {@code @아이디}로 붙여 넣어도 받는다. 대문자는 소문자로. */
    static String normalize(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.startsWith("@")) {
            value = value.substring(1);
        }
        value = value.toLowerCase(Locale.ROOT);
        if (!USERNAME.matcher(value).matches()) {
            throw new BusinessException(
                    CommonErrorCode.INVALID_REQUEST, "invalid mattermost username");
        }
        return value;
    }

    private User activeUser(String userId) {
        return userRepository
                .findById(userId)
                .filter(User::isActive)
                .orElseThrow(() -> new BusinessException(AuthErrorCode.UNAUTHORIZED));
    }

    private String codeMessage(String code) {
        long minutes = properties.codeTtl().toMinutes();
        // 코드는 크게(제목 크기 코드 블록) 보여 한눈에 읽고 복사하기 쉽게(S15P31B204-532)
        return "#### 🔐 Mattermost 알림 확인 코드\n## `"
                + code
                + "`\n"
                + minutes
                + "분 동안만 쓸 수 있어요. 직접 요청하지 않았다면 이 메시지는 무시해 주세요.";
    }

    static String hash(String code) {
        try {
            byte[] digest =
                    MessageDigest.getInstance("SHA-256")
                            .digest(code.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
