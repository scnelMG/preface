package com.preface.api.capture.service;

import com.preface.api.capture.dto.MultipartCompleteRequest;
import com.preface.api.capture.dto.MultipartPartUrl;
import com.preface.api.capture.dto.MultipartPartsResponse;
import com.preface.api.capture.dto.MultipartStartRequest;
import com.preface.api.capture.dto.MultipartStartResponse;
import com.preface.common.capture.entity.CaptureMethod;
import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.capture.repository.FaceUploadRepository;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CaptureErrorCode;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.response.ErrorBody;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.model.CompletedPart;
import software.amazon.awssdk.services.s3.model.S3Exception;

/**
 * 영상 multipart 업로드(S15P31B204-506, 명세 반영 전 가칭 API-CAP-05~08). 큰 영상을 조각으로 나눠 FE가 S3에 직접 병렬로 올리고, 끊긴
 * 조각만 다시 올리게 한다. 바이트는 Spring을 지나지 않는다.
 *
 * <p>업로드가 끝난 뒤의 흐름은 단일 PUT(CAP-01)과 같다: FE가 같은 {@code uploadId}로 REC-01을 부른다. {@code face_upload}
 * 행도 같은 모양으로 만든다({@code checksum_sha256} = 파일 전체 SHA-256, 프레임 추출기가 확인).
 */
@Service
@RequiredArgsConstructor
public class MultipartUploadService {

    private final CaptureGuard captureGuard;
    private final UploadProperties properties;
    private final VideoUploadPresigner presigner;
    private final VideoMultipartStorage storage;
    private final MultipartUploadStore store;
    private final FaceUploadRepository faceUploadRepository;

    /** 검사 순서는 CAP-01과 같다: 얼굴 동의(CAP_001) → 진행 중 작업(REC_002) → 정책(CAP_002) → 조각 수(COMMON_001). */
    public MultipartStartResponse start(String userId, MultipartStartRequest request) {
        captureGuard.requireReady(userId);
        List<ErrorBody.FieldError> violations =
                UploadService.violations(properties, request.toUploadRequest());
        if (!violations.isEmpty()) {
            throw new BusinessException(CaptureErrorCode.UPLOAD_POLICY_VIOLATION, violations);
        }
        long partSize = properties.partSizeBytes();
        long expectedParts = (request.sizeBytes() + partSize - 1) / partSize;
        if (expectedParts < 2 || request.partChecksums().size() != expectedParts) {
            // 한 조각이면 CAP-01(단일 PUT)을 쓴다. 조각 수가 다르면 FE가 다른 조각 크기로 나눈 것이다
            throw new BusinessException(
                    CommonErrorCode.INVALID_REQUEST,
                    List.of(
                            new ErrorBody.FieldError(
                                    "partChecksums",
                                    "partSizeBytes=" + partSize + ",partCount=" + expectedParts)));
        }

        String uploadId = UUID.randomUUID().toString();
        String objectKey = UploadService.objectKey(userId, uploadId, request.contentType());
        String s3UploadId =
                storage.create(
                        objectKey, request.contentType(), composite(request.partChecksums()));
        MultipartUploadStore.State state =
                new MultipartUploadStore.State(
                        userId,
                        objectKey,
                        s3UploadId,
                        request.sizeBytes(),
                        partSize,
                        List.copyOf(request.partChecksums()),
                        false);
        List<Integer> all = new ArrayList<>();
        for (int n = 1; n <= state.partCount(); n++) {
            all.add(n);
        }
        Presigned presigned = presign(state, all);
        store.save(uploadId, state);
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
        return new MultipartStartResponse(
                uploadId, partSize, presigned.parts(), presigned.expiresAt());
    }

    /** 가칭 API-CAP-06. URL이 만료됐거나 실패한 조각을 다시 서명한다. */
    public MultipartPartsResponse presignParts(
            String userId, String uploadId, List<Integer> partNumbers) {
        MultipartUploadStore.State state = owned(userId, uploadId);
        if (state.completed()) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST, "already completed");
        }
        for (int n : partNumbers) {
            if (n < 1 || n > state.partCount()) {
                throw new BusinessException(
                        CommonErrorCode.INVALID_REQUEST,
                        List.of(
                                new ErrorBody.FieldError(
                                        "partNumbers", "partCount=" + state.partCount())));
            }
        }
        Presigned presigned = presign(state, partNumbers.stream().distinct().toList());
        return new MultipartPartsResponse(presigned.parts(), presigned.expiresAt());
    }

    /**
     * 가칭 API-CAP-07. 모든 조각이 있어야 한다. 이미 완료했으면 그대로 성공(재시도 멱등).
     *
     * <p>빠진 조각·틀린 ETag·사라진 업로드는 CAP_003(다시 올리기), 조각 내용이 서명한 체크섬과 다르면 CAP_005.
     */
    public void complete(String userId, String uploadId, MultipartCompleteRequest request) {
        MultipartUploadStore.State state = owned(userId, uploadId);
        if (state.completed()) {
            return;
        }
        Set<Integer> seen = new HashSet<>();
        for (MultipartCompleteRequest.Part part : request.parts()) {
            if (part.partNumber() < 1
                    || part.partNumber() > state.partCount()
                    || !seen.add(part.partNumber())) {
                throw new BusinessException(
                        CommonErrorCode.INVALID_REQUEST,
                        List.of(
                                new ErrorBody.FieldError(
                                        "parts", "partCount=" + state.partCount())));
            }
        }
        if (seen.size() != state.partCount()) {
            throw new BusinessException(CaptureErrorCode.UPLOAD_OBJECT_MISSING, "parts missing");
        }
        List<CompletedPart> parts =
                request.parts().stream()
                        .sorted(Comparator.comparingInt(MultipartCompleteRequest.Part::partNumber))
                        .map(
                                p ->
                                        CompletedPart.builder()
                                                .partNumber(p.partNumber())
                                                .eTag(p.etag())
                                                .checksumSHA256(
                                                        state.partChecksums()
                                                                .get(p.partNumber() - 1))
                                                .build())
                        .toList();

        String actual;
        try {
            actual = storage.complete(state.objectKey(), state.s3UploadId(), parts);
        } catch (S3Exception e) {
            String code = e.awsErrorDetails() == null ? "" : e.awsErrorDetails().errorCode();
            switch (code) {
                case "InvalidPart", "InvalidPartOrder", "NoSuchUpload" ->
                        throw new BusinessException(CaptureErrorCode.UPLOAD_OBJECT_MISSING, code);
                case "BadDigest", "InvalidDigest" ->
                        throw new BusinessException(
                                CaptureErrorCode.UPLOAD_CHECKSUM_MISMATCH, code);
                default -> throw e;
            }
        }
        if (!composite(state.partChecksums()).equals(actual)) {
            // 선언과 다른 객체는 쓰지 않는다(REC-01 checkUpload와 같은 규칙)
            storage.delete(state.objectKey());
            store.delete(uploadId);
            throw new BusinessException(CaptureErrorCode.UPLOAD_CHECKSUM_MISMATCH, "composite");
        }
        store.save(uploadId, state.complete());
    }

    /** 가칭 API-CAP-08. 사용자가 취소했다. 없거나 끝난 업로드도 성공(멱등). 끝난 객체는 원본 보관 정리가 지운다. */
    public void abort(String userId, String uploadId) {
        var found = store.find(uploadId);
        if (found.isEmpty()) {
            return;
        }
        MultipartUploadStore.State state = found.get();
        if (!state.userId().equals(userId)) {
            throw new BusinessException(CommonErrorCode.NOT_FOUND);
        }
        if (!state.completed()) {
            storage.abort(state.objectKey(), state.s3UploadId());
        }
        store.delete(uploadId);
    }

    /**
     * S3 composite SHA-256: 조각 digest(32바이트)를 순서대로 이어 붙인 값의 SHA-256(base64) + {@code -조각수}. S3가
     * multipart 객체에 돌려주는 값과 같은 방식이다.
     */
    static String composite(List<String> partChecksums) {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
        Base64.Decoder decoder = Base64.getDecoder();
        for (String part : partChecksums) {
            digest.update(decoder.decode(part));
        }
        return Base64.getEncoder().encodeToString(digest.digest()) + "-" + partChecksums.size();
    }

    /** 남의 업로드는 있다는 것을 숨긴다(COMMON_002). 없으면(24시간 지남) 만료(CAP_004). */
    private MultipartUploadStore.State owned(String userId, String uploadId) {
        MultipartUploadStore.State state =
                store.find(uploadId)
                        .orElseThrow(() -> new BusinessException(CaptureErrorCode.UPLOAD_EXPIRED));
        if (!state.userId().equals(userId)) {
            throw new BusinessException(CommonErrorCode.NOT_FOUND);
        }
        return state;
    }

    private Presigned presign(MultipartUploadStore.State state, List<Integer> partNumbers) {
        List<MultipartPartUrl> urls = new ArrayList<>();
        Instant expiresAt = null;
        for (int n : partNumbers) {
            VideoUploadPresigner.PresignedUpload p =
                    presigner.presignPart(
                            state.objectKey(),
                            state.s3UploadId(),
                            n,
                            state.partSize(n),
                            state.partChecksums().get(n - 1),
                            properties.urlTtl());
            urls.add(new MultipartPartUrl(n, p.url(), p.headers()));
            expiresAt = p.expiresAt();
        }
        return new Presigned(List.copyOf(urls), expiresAt);
    }

    private record Presigned(List<MultipartPartUrl> parts, Instant expiresAt) {}
}
