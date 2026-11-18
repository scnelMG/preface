package com.preface.jobmanager.deletion.service;

import com.preface.jobmanager.global.config.StorageProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;

@Component
@RequiredArgsConstructor
class S3DeletionStorage implements DeletionStorage {

    private final S3Client s3Client;
    private final StorageProperties storage;

    /** AWS S3는 없는 key에도 204지만, 404(NoSuchKey)를 주는 S3 호환 스토리지도 있어 둘 다 성공으로 본다. */
    @Override
    public void delete(String objectKey) {
        try {
            s3Client.deleteObject(r -> r.bucket(storage.bucket()).key(objectKey));
        } catch (NoSuchKeyException e) {
            // 이미 없다
        } catch (S3Exception e) {
            if (e.statusCode() != 404) {
                throw e;
            }
        }
    }
}
