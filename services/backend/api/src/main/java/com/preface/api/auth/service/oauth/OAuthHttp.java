package com.preface.api.auth.service.oauth;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/** 제공자 호출용 RestClient. 제공자가 느려도 로그인 요청이 오래 붙잡히지 않게 타임아웃을 짧게 둔다. */
final class OAuthHttp {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(5);

    private OAuthHttp() {}

    static RestClient restClient(RestClient.Builder builder) {
        HttpClient httpClient = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(READ_TIMEOUT);
        return builder.clone().requestFactory(factory).build();
    }
}
