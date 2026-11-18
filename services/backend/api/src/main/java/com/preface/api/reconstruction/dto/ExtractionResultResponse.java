package com.preface.api.reconstruction.dto;

/**
 * INT-EXT-03 응답 data.
 *
 * @param accepted false면 이 워커·시도의 작업이 아니다(취소·lease 회수). 워커는 작업을 버린다 — 올린 프레임은 서버가 지운다
 */
public record ExtractionResultResponse(boolean accepted) {}
