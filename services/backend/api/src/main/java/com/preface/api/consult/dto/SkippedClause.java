package com.preface.api.consult.dto;

/** 적용하지 않은 원문 구절과 이유({@code skipped[]}). 원문 구절은 AI가 마스킹한 문장의 일부다. */
public record SkippedClause(String source, String reason) {}
