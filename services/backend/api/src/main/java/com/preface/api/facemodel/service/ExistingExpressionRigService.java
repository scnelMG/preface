package com.preface.api.facemodel.service;

import com.preface.api.facemodel.dto.ExpressionRigRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.reconstruction.ReconstructionOutputKeys;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 표정 리그가 없는 기존 모델에 표정 트래킹 리그를 보충한다(S15P31B204-879). 새 모델은 결과 보고(INT-REC-03)에서 받는다.
 *
 * <p>key는 그 모델 메시와 같은 폴더의 {@code expression.json}만 받는다(다른 모델·회원의 파일을 가리키지 못한다). 코·눈 승인과 시안은 그대로 둔다.
 */
@Service
@RequiredArgsConstructor
public class ExistingExpressionRigService {

    private final FaceModelRepository models;

    /** 같은 key로 다시 불러도 그대로 성공한다(멱등). 삭제·모델 교체와 같은 행 잠금 아래에서 확인하고 저장한다. */
    @Transactional
    public void attach(String faceModelId, ExpressionRigRequest request) {
        FaceModel model =
                models.findByIdAndDeletedAtIsNull(faceModelId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        if (!ReconstructionOutputKeys.expressionBeside(model.getMeshObjectKey())
                .equals(request.objectKey())) {
            throw new BusinessException(
                    CommonErrorCode.INVALID_REQUEST,
                    "objectKey must be expression.json beside the mesh");
        }
        model.attachExpressionRig(request.objectKey());
    }
}
