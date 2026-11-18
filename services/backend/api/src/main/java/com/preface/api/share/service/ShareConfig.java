package com.preface.api.share.service;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** share 영역 설정. global.config에 두면 global → share 의존이 생겨 여기 둔다(CaptureConfig와 같은 이유). */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ShareProperties.class)
class ShareConfig {}
