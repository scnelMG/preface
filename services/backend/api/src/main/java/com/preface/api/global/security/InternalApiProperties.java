package com.preface.api.global.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 내부 API 설정({@code preface.internal.*}).
 *
 * @param secret GPU 워커와 나누는 공유 시크릿(환경 변수 {@code INTERNAL_API_SECRET}, 32바이트 이상). 비어 있으면 내부 API가 모두
 *     401이다
 */
@ConfigurationProperties("preface.internal")
public record InternalApiProperties(String secret) {}
