package com.preface.api.auth.dto;

/**
 * API-AUTH-11 응답.
 *
 * @param deletionStatus 항상 {@code PENDING}. DB 삭제는 끝났고 S3 객체 삭제는 삭제 작업이 이어서 한다
 */
public record WithdrawalResponse(String deletionStatus) {

    public static final String PENDING = "PENDING";
}
