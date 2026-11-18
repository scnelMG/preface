package com.preface.api.reconstruction.dto;

/** 워커 식별자 형식(계약 {@code X-Worker-Id}·{@code workerId}). */
public final class WorkerIds {

    public static final String PATTERN = "^[A-Za-z0-9._-]{1,64}$";
    public static final String HEADER = "X-Worker-Id";

    private WorkerIds() {}

    public static boolean valid(String workerId) {
        return workerId != null && workerId.matches(PATTERN);
    }
}
