package com.preface.api.facereading.service;

import com.preface.api.capture.service.StorageProperties;
import java.io.IOException;
import java.io.InputStream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import tools.jackson.databind.ObjectMapper;

/**
 * S3의 프레임 묶음을 서버 안에서 읽어 정면 프레임만 꺼낸다(S15P31B204-438). 묶음·사진은 디스크에 쓰지 않고 메모리에서만 다룬 뒤 버린다.
 *
 * <p>묶음은 3D가 성공하면 바로 지워지므로, 그사이 지워졌으면 {@code PHOTO_GONE}이다.
 */
@Component
@RequiredArgsConstructor
class S3FrontFrameSource implements FrontFrameSource {

    private final S3Client s3Client;
    private final StorageProperties storage;
    private final ObjectMapper mapper;

    @Override
    public byte[] frontJpeg(String framesObjectKey) {
        GetObjectRequest request =
                GetObjectRequest.builder().bucket(storage.bucket()).key(framesObjectKey).build();
        try (InputStream tar = s3Client.getObject(request)) {
            return FrontFrame.fromBundle(tar, mapper);
        } catch (NoSuchKeyException e) {
            throw new FaceReadingFailure(FaceReadingFailure.PHOTO_GONE, "frames bundle deleted");
        } catch (IOException e) {
            throw new FaceReadingFailure(
                    FaceReadingFailure.BAD_BUNDLE, "frames bundle read failed");
        }
    }
}
