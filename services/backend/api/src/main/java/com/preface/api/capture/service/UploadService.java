package com.preface.api.capture.service;

import com.preface.api.capture.dto.UploadPolicyResponse;
import com.preface.api.capture.dto.UploadRequest;
import com.preface.api.capture.dto.UploadResponse;
import com.preface.common.capture.entity.CaptureMethod;
import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.repository.FaceUploadRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CaptureErrorCode;
import com.preface.common.response.ErrorBody;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 영상 업로드 URL 발급(API-CAP-01)·업로드 정책(API-CAP-02). 일반 세션과 업로드 전용 세션 모두 쓴다. */
@Service
@RequiredArgsConstructor
public class UploadService {

    /** S3 key 확장자. 허용 형식 목록(설정)에 있어도 여기 없으면 발급하지 않는다. */
    private static final Map<String, String> EXTENSIONS =
            Map.of("video/mp4", "mp4", "video/webm", "webm", "video/quicktime", "mov");

    private final CaptureGuard captureGuard;
    private final UploadProperties properties;
    private final VideoUploadPresigner presigner;
    private final FaceUploadRepository faceUploadRepository;

    /** 검사 순서(명세): 얼굴 동의(CAP_001) → 진행 중 작업(REC_002) → 정책(CAP_002). */
    public UploadResponse issue(String userId, UploadRequest request) {
        captureGuard.requireReady(userId);
        List<ErrorBody.FieldError> violations = violations(request);
        if (!violations.isEmpty()) {
            throw new BusinessException(CaptureErrorCode.UPLOAD_POLICY_VIOLATION, violations);
        }

        String uploadId = UUID.randomUUID().toString();
        String objectKey = objectKey(userId, uploadId, request.contentType());
        VideoUploadPresigner.PresignedUpload presigned =
                presigner.presignPut(
                        objectKey,
                        request.contentType(),
                        request.sizeBytes(),
                        request.checksumSha256(),
                        properties.urlTtl());
        FaceUpload upload =
                FaceUpload.issue(
                        uploadId,
                        userId,
                        objectKey,
                        request.contentType(),
                        request.sizeBytes(),
                        request.durationMs(),
                        request.checksumSha256(),
                        presigned.expiresAt());
        // 촬영 방식은 정책 검사에서 WEB_RECORDER만 통과한다
        upload.recordCapture(
                CaptureMethod.WEB_RECORDER,
                request.deviceModel(),
                CaptureTraces.sanitize(request.captureMethod(), request.captureTrace()));
        faceUploadRepository.save(upload);
        return new UploadResponse(
                uploadId, presigned.url(), "PUT", presigned.headers(), presigned.expiresAt());
    }

    static String objectKey(String userId, String uploadId, String contentType) {
        return "users/%s/uploads/%s.%s".formatted(userId, uploadId, EXTENSIONS.get(contentType));
    }

    public UploadPolicyResponse policy() {
        UploadProperties.Video video = properties.video();
        return new UploadPolicyResponse(
                new UploadPolicyResponse.Video(
                        video.allowedContentTypes(),
                        video.maxSizeBytes(),
                        video.minDurationMs(),
                        video.maxDurationMs(),
                        video.recommendedDurationMs()),
                properties.urlTtl().toSeconds(),
                properties.partSizeBytes());
    }

    /** CAP_002 사유. {@code details[].reason}에 API-CAP-02와 같은 정책 값을 적는다. */
    private List<ErrorBody.FieldError> violations(UploadRequest request) {
        return violations(properties, request);
    }

    /** CAP-01과 multipart 시작(S15P31B204-506)이 같은 정책으로 검사한다. */
    static List<ErrorBody.FieldError> violations(
            UploadProperties properties, UploadRequest request) {
        UploadProperties.Video video = properties.video();
        List<ErrorBody.FieldError> violations = new ArrayList<>();
        if (!video.allowedContentTypes().contains(request.contentType())
                || !EXTENSIONS.containsKey(request.contentType())) {
            violations.add(
                    new ErrorBody.FieldError(
                            "contentType",
                            "allowedContentTypes="
                                    + String.join(",", video.allowedContentTypes())));
        }
        if (request.sizeBytes() <= 0 || request.sizeBytes() > video.maxSizeBytes()) {
            violations.add(
                    new ErrorBody.FieldError("sizeBytes", "maxSizeBytes=" + video.maxSizeBytes()));
        }
        if (request.durationMs() < video.minDurationMs()
                || request.durationMs() > video.maxDurationMs()) {
            violations.add(
                    new ErrorBody.FieldError(
                            "durationMs",
                            "minDurationMs="
                                    + video.minDurationMs()
                                    + ",maxDurationMs="
                                    + video.maxDurationMs()));
        }
        if (!CaptureMethod.WEB_RECORDER.name().equals(request.captureMethod())) {
            // 이 화면에서 녹화한 영상만 받는다(S15P31B204-929). 파일 올리기(FILE)·예전 FE(값 없음)도 거절
            violations.add(
                    new ErrorBody.FieldError(
                            "captureMethod",
                            "allowedCaptureMethods=" + CaptureMethod.WEB_RECORDER));
        }
        return violations;
    }
}
