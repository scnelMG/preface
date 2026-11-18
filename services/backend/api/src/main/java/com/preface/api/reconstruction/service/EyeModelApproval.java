package com.preface.api.reconstruction.service;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import java.util.Map;

/** 생성 성공과 같은 거래에서 눈 승인 한계를 저장하는 경계. 결속·판정이 맞지 않으면 저장하지 않고 false. */
public interface EyeModelApproval {
    boolean approveForGeneration(String modelId, EyeApprovalRequest request);

    /** 실제 자산을 잠금 밖에서 확인한다. 검사기 일시 장애는 REC_023으로 구분한다. */
    boolean verifyAssets(
            String meshObjectKey,
            String rigObjectKey,
            Map<String, String> review,
            EyeApprovalRequest request);

    boolean approveWithVerifiedAssets(String modelId, EyeApprovalRequest request);
}
