package com.preface.api.reconstruction.service;

import com.preface.api.reconstruction.dto.NoseApprovalRequest;

/** 생성 결과의 코 편집 범위를 검사기로 확인하는 경계. */
public interface NoseModelApproval {

    /**
     * 워커가 올린 메시·리그로 코 범위의 각 끝값을 검사한다. DB를 읽거나 쓰지 않아 결과 저장 트랜잭션 밖(작업 행 잠금 전)에서 부른다 (S15P31B204-518).
     *
     * @return {@code face_model.approved_nose_capabilities}에 저장할 승인 JSON
     */
    String validateForGeneration(
            String meshObjectKey, String rigObjectKey, NoseApprovalRequest request);
}
