package com.preface.api.reconstruction.service;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ReconstructionProperties.class)
class ReconstructionConfig {}
