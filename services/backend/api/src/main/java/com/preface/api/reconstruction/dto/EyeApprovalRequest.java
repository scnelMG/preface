package com.preface.api.reconstruction.dto;

import java.util.Map;

/**
 * 워커가 잰 눈 승인 한계 후보(S15P31B204-521). 계약: {@code result-request.schema.json}의 {@code eyeApproval}.
 *
 * <p>형식·결속 검사는 서비스가 한다. 맞지 않으면 생성은 그대로 두고 눈 편집만 잠근다.
 */
public record EyeApprovalRequest(
        String schemaVersion, Binding binding, Map<String, Double> limits) {
    public record Binding(
            String meshSha256,
            String rigSha256,
            String eyePartsSha256,
            String engine,
            String rigVersion,
            String topologyVersion) {}
}
