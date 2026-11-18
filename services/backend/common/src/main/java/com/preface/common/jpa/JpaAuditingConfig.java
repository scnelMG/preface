package com.preface.common.jpa;

import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/** {@code @CreatedDate}·{@code @LastModifiedDate} 자동 기록. api·job-manager가 함께 쓴다. */
@Configuration(proxyBeanMethods = false)
@EnableJpaAuditing
public class JpaAuditingConfig {}
