package com.preface.api.facereading.service;

/** 프레임 묶음 key → 관상에 보낼 줄인 정면 JPEG. 구현은 {@link S3FrontFrameSource}, 테스트는 mock한다. */
public interface FrontFrameSource {

    /**
     * @throws FaceReadingFailure 묶음이 없거나({@code PHOTO_GONE}) 정면 프레임이 없거나({@code NO_FRONT}) 형식이 깨졌을
     *     때({@code BAD_BUNDLE})
     */
    byte[] frontJpeg(String framesObjectKey);
}
