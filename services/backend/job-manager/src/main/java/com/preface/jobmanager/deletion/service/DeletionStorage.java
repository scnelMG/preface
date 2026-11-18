package com.preface.jobmanager.deletion.service;

/** 삭제 작업이 쓰는 S3 동작. 구현은 {@link S3DeletionStorage}. 테스트는 이 인터페이스를 mock한다. */
public interface DeletionStorage {

    /** 객체를 지운다. 이미 없으면 성공으로 본다(S3 DeleteObject는 없는 key에도 204). 실패하면 예외를 던진다. */
    void delete(String objectKey);
}
