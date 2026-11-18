package com.preface.common.reconstruction.entity;

/** 복원 실패 코드. 사용자 문구·고치는 방법은 FE 사전이 코드별로 만든다(FN-CAP-03). */
public enum ReconstructionFailCode {
    QUALITY_NO_FACE,
    QUALITY_ANGLE,
    QUALITY_LIGHT,
    QUALITY_COMPRESSED,
    FIT_FAILED,
    TIMEOUT,
    INTERNAL
}
