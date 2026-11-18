package com.preface.api.simulation.service;

/** morph 항목 하나의 허용 범위({@code morph_parameter.min/max}). 편집 규칙을 엔티티 없이 시험하려고 따로 둔다. */
public record MorphRange(String code, String label, double min, double max) {}
