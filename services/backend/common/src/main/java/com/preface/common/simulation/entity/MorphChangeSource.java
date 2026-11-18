package com.preface.common.simulation.entity;

/** 가중치 변경 이력의 출처. INIT은 시안 생성 때의 seq 0(빈 가중치). */
public enum MorphChangeSource {
    INIT,
    CHAT,
    SLIDER,
    POINT,
    RESET
}
