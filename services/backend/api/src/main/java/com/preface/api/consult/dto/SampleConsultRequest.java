package com.preface.api.consult.dto;

import java.util.List;
import java.util.Map;

/** 로그인 회원의 기본 모델 체험 상담. 얼굴 자산·대화·조절값은 서버에 저장하지 않는다. */
public record SampleConsultRequest(
        String content,
        String requestId,
        String meshSha256,
        Map<String, Double> weights,
        List<String> supportedCodes,
        boolean eyeAvailable,
        boolean eyeFoldEnabled,
        boolean eyeEdited) {}
