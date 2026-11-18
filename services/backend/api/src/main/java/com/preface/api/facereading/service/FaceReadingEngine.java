package com.preface.api.facereading.service;

/**
 * 정면 사진 1장 → 관상 풀이(JSON). 지금은 GMS({@link GmsFaceReadingEngine})이고, 2단계에서 작은 오픈 모델(로컬)로 바꿀 수 있게
 * 인터페이스로 둔다(설계안 "로컬 모델 증류"). 결과 JSON 형식({@link FaceReadingResult})이 학습 데이터 형식이 된다.
 */
public interface FaceReadingEngine {

    /**
     * @param jpeg 줄인 정면 JPEG(긴 변 768px 이하, 메타데이터 없음)
     * @throws FaceReadingFailure GMS 장애({@code AI_UNAVAILABLE})·거절이나 형식 오류({@code AI_REJECTED})
     */
    Reading read(byte[] jpeg);

    /** 검증을 통과한 결과 JSON과 만든 모델 이름. */
    record Reading(String resultJson, String model) {}
}
