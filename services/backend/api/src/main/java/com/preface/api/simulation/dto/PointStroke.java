package com.preface.api.simulation.dto;

import java.util.List;

/** 코 피부 메시 앵커와 모델 대각선 대비 XYZ 상대 변위. */
public record PointStroke(int vertex, List<Double> delta) {}
