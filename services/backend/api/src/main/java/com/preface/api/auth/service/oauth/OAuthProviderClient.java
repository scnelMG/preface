package com.preface.api.auth.service.oauth;

import com.preface.common.user.entity.OAuthProvider;

/**
 * 소셜 제공자 연동. 제공자마다 구현체 하나.
 *
 * <p>인터페이스로 둔 이유: 통합 테스트에서 실제 카카오·구글을 부르지 않고 가짜 구현으로 바꾸기 위해서다.
 */
public interface OAuthProviderClient {

    OAuthProvider provider();

    /** FE가 사용자를 보낼 제공자 로그인 주소. */
    String authorizeUrl(String redirectUri, String state);

    /**
     * 인가 코드로 토큰을 받고 사용자 정보를 조회한다.
     *
     * @throws com.preface.common.error.BusinessException AUTH_013 제공자 통신 실패·코드 무효
     */
    OAuthProfile fetchProfile(String code, String redirectUri);
}
