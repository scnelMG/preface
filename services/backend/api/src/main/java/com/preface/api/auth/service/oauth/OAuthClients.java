package com.preface.api.auth.service.oauth;

import com.preface.common.error.AuthErrorCode;
import com.preface.common.error.BusinessException;
import com.preface.common.user.entity.OAuthProvider;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * path 값(kakao·google)으로 제공자 구현을 찾는다. 없으면 AUTH_010.
 *
 * <p>조회할 때마다 {@code provider()}를 확인한다(구현체가 2개뿐). 생성 시점에 맵을 만들면 테스트에서 mock으로 바꾼 구현의 값을 읽지 못한다.
 */
@Component
@RequiredArgsConstructor
public class OAuthClients {

    private final List<OAuthProviderClient> clients;

    public OAuthProviderClient get(String providerPath) {
        OAuthProvider provider =
                OAuthProvider.fromPath(providerPath)
                        .orElseThrow(
                                () -> new BusinessException(AuthErrorCode.UNSUPPORTED_PROVIDER));
        return clients.stream()
                .filter(c -> c.provider() == provider)
                .findFirst()
                .orElseThrow(() -> new BusinessException(AuthErrorCode.UNSUPPORTED_PROVIDER));
    }
}
