package com.preface.api.admin.service;

import com.preface.api.admin.dto.AdminFaceModelAssetsResponse;
import com.preface.api.admin.dto.AdminFaceModelAssetsResponse.CaptureImage;
import com.preface.api.admin.dto.AdminFaceModelListResponse;
import com.preface.api.admin.dto.AdminStorageResponse;
import com.preface.api.admin.dto.AdminStorageResponse.DeletionFailure;
import com.preface.api.admin.service.AdminStorage.SignedUrl;
import com.preface.api.admin.service.StorageReconciler.DbKey;
import com.preface.api.admin.service.StorageReconciler.DeletionMark;
import com.preface.common.admin.entity.AdminAccessTargetType;
import com.preface.common.admin.repository.AdminUserDataRepository;
import com.preface.common.admin.repository.AdminUserDataRepository.FaceModelRow;
import com.preface.common.capture.entity.FaceUpload;
import com.preface.common.deletion.entity.DataDeletionLog;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.facemodel.entity.FaceCaptureImage;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceCaptureImageRepository;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 관리자: 회원별 3D 목록·3D 파일·S3 보관 목록(S15P31B204-653). 권한 확인은 보안 필터가 이미 마쳤다.
 *
 * <p>회원 데이터를 내리기 전에 조회 기록({@link AdminAccessLogger})을 남긴다. 서명 URL은 로그·조회 기록에 넣지 않는다. 운영에서는 촬영 사진을
 * 내리지 않는다(REQ-N-25).
 */
@Service
@Transactional(readOnly = true)
public class AdminUserDataService {

    static final int DEFAULT_PAGE_SIZE = 20;
    static final int MAX_PAGE_SIZE = 100;

    /** 한 회원 prefix에서 나열할 최대 객체 수. 넘으면 truncated. */
    static final int MAX_STORAGE_OBJECTS = 2000;

    static final String STATUS_PENDING = DataDeletionLog.STATUS_PENDING;
    static final String STATUS_FAILED = "FAILED";

    static final String SOURCE_FACE_UPLOAD = "FACE_UPLOAD";
    static final String SOURCE_FACE_UPLOAD_FRAMES = "FACE_UPLOAD_FRAMES";
    static final String SOURCE_FACE_MODEL = "FACE_MODEL";
    static final String SOURCE_FACE_CAPTURE_IMAGE = "FACE_CAPTURE_IMAGE";
    static final String SOURCE_JOB_STAGE_LOG = "JOB_STAGE_LOG";

    /** userId는 UUID 문자열만 받는다. prefix를 다른 폴더로 넓히지 못하게 한다. */
    private static final Pattern USER_ID = Pattern.compile("[0-9a-fA-F-]{36}");

    private final AdminUserDataRepository adminRepository;
    private final FaceModelRepository faceModelRepository;
    private final FaceCaptureImageRepository captureImageRepository;
    private final AdminStorage storage;
    private final AdminAccessLogger accessLogger;
    private final AdminProperties adminProperties;
    private final Clock clock;
    private final Duration softDeleteRetention;

    /**
     * @param softDeleteRetention 소프트 삭제 뒤 물리 삭제까지(job-manager 삭제 배치의 {@code
     *     preface.deletion.soft-delete-retention}과 같은 값, 기본 30일 FN-HIS-03)
     */
    public AdminUserDataService(
            AdminUserDataRepository adminRepository,
            FaceModelRepository faceModelRepository,
            FaceCaptureImageRepository captureImageRepository,
            AdminStorage storage,
            AdminAccessLogger accessLogger,
            AdminProperties adminProperties,
            Clock clock,
            @Value("${preface.deletion.soft-delete-retention:30d}") Duration softDeleteRetention) {
        this.adminRepository = adminRepository;
        this.faceModelRepository = faceModelRepository;
        this.captureImageRepository = captureImageRepository;
        this.storage = storage;
        this.accessLogger = accessLogger;
        this.adminProperties = adminProperties;
        this.clock = clock;
        this.softDeleteRetention = softDeleteRetention;
    }

    /** 회원별 3D 목록(삭제된 것 포함), 최신순. 시안 수는 묶음 쿼리 한 번으로 센다. */
    public AdminFaceModelListResponse faceModels(
            String adminUserId, String userId, Integer page, Integer size, String requestPath) {
        requireUserId(userId);
        int safePage = page == null ? 0 : Math.max(page, 0);
        int safeSize = size == null ? DEFAULT_PAGE_SIZE : Math.clamp(size, 1, MAX_PAGE_SIZE);
        Page<FaceModelRow> result =
                adminRepository.findFaceModelsByUserId(userId, PageRequest.of(safePage, safeSize));
        Map<String, Long> counts = simulationCounts(result.getContent());
        List<AdminFaceModelListResponse.Item> items =
                result.getContent().stream()
                        .map(
                                row ->
                                        new AdminFaceModelListResponse.Item(
                                                row.getFaceModelId(),
                                                row.getJobId(),
                                                row.getCreatedAt(),
                                                row.getVideoDurationMs(),
                                                row.getJobStatus() == null
                                                        ? null
                                                        : row.getJobStatus().name(),
                                                counts.getOrDefault(row.getFaceModelId(), 0L),
                                                row.getDeletedAt(),
                                                purgeAt(row.getDeletedAt())))
                        .toList();
        accessLogger.record(
                adminUserId, userId, AdminAccessTargetType.FACE_MODEL, null, requestPath);
        return new AdminFaceModelListResponse(
                items, safePage, safeSize, result.getTotalElements(), result.getTotalPages());
    }

    /**
     * 3D 파일·썸네일·촬영 사진 presigned GET(5분). 삭제된 3D도 물리 삭제 전이면 연다. 없으면 COMMON_002(404).
     *
     * <p>촬영 사진은 운영이 아닐 때만 준다. 사진을 줬으면 조회 기록을 {@code CAPTURE_IMAGE}로 한 건 더 남긴다.
     */
    public AdminFaceModelAssetsResponse assets(
            String adminUserId, String faceModelId, String requestPath) {
        FaceModel model =
                faceModelRepository
                        .findById(faceModelId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        SignedUrl mesh = storage.presignGet(model.getMeshObjectKey());
        String thumbnailUrl =
                model.getThumbnailObjectKey() == null
                        ? null
                        : storage.presignGet(model.getThumbnailObjectKey()).url();
        List<CaptureImage> captures =
                adminProperties.isProduction()
                        ? List.of()
                        : captureImageRepository.findAllByFaceModelId(faceModelId).stream()
                                .sorted(Comparator.comparing(FaceCaptureImage::getAngle))
                                .map(
                                        image ->
                                                new CaptureImage(
                                                        image.getAngle().name(),
                                                        storage.presignGet(image.getObjectKey())
                                                                .url()))
                                .toList();
        accessLogger.record(
                adminUserId,
                model.getUserId(),
                AdminAccessTargetType.FACE_MODEL,
                faceModelId,
                requestPath);
        if (!captures.isEmpty()) {
            accessLogger.record(
                    adminUserId,
                    model.getUserId(),
                    AdminAccessTargetType.CAPTURE_IMAGE,
                    faceModelId,
                    requestPath);
        }
        return new AdminFaceModelAssetsResponse(
                model.getId(), mesh.expiresAt(), mesh.url(), null, thumbnailUrl, captures);
    }

    /** 회원 한 명의 S3 prefix({@code users/{userId}/})만 나열하고 DB key와 대조한다(REQ-N-26). */
    public AdminStorageResponse storage(String adminUserId, String userId, String requestPath) {
        requireUserId(userId);
        String prefix = "users/" + userId + "/";
        Instant checkedAt = clock.instant();

        Map<String, DbKey> dbKeys = dbKeys(userId);
        List<DataDeletionLog> logs =
                adminRepository.findDeletionLogs(userId, List.of(STATUS_PENDING, STATUS_FAILED));
        Map<String, DeletionMark> deletions = new HashMap<>();
        for (DataDeletionLog log : logs) {
            boolean failed = STATUS_FAILED.equals(log.getStatus());
            // 같은 key에 기록이 여럿이면 FAILED를 우선한다(오래된 순으로 읽어 첫 기록 시각을 남긴다)
            deletions.merge(
                    log.getObjectKey(),
                    new DeletionMark(failed, log.getCreatedAt()),
                    (a, b) -> new DeletionMark(a.failed() || b.failed(), a.scheduledAt()));
        }
        List<DeletionFailure> failures =
                logs.stream()
                        .filter(log -> STATUS_FAILED.equals(log.getStatus()))
                        .map(
                                log ->
                                        new DeletionFailure(
                                                log.getObjectKey(),
                                                log.getReason(),
                                                log.getRetryCount()))
                        .toList();

        AdminStorage.Listing listing = storage.list(prefix, MAX_STORAGE_OBJECTS);
        var objects = StorageReconciler.reconcile(prefix, listing, dbKeys, deletions);
        accessLogger.record(adminUserId, userId, AdminAccessTargetType.STORAGE, null, requestPath);
        return new AdminStorageResponse(
                userId, prefix, checkedAt, listing.truncated(), objects, failures);
    }

    /** DB가 가리키는 이 회원의 S3 key 전부. 소프트 삭제된 행도 포함한다(물리 삭제 전까지 객체가 남는다). */
    private Map<String, DbKey> dbKeys(String userId) {
        Map<String, DbKey> keys = new HashMap<>();
        for (FaceUpload upload : adminRepository.findUploadsByUserId(userId)) {
            put(keys, upload.getObjectKey(), SOURCE_FACE_UPLOAD, upload.getRetentionExpiresAt());
            put(
                    keys,
                    upload.getFramesObjectKey(),
                    SOURCE_FACE_UPLOAD_FRAMES,
                    upload.getRetentionExpiresAt());
        }
        Map<String, Instant> modelPurgeAt = new HashMap<>();
        for (FaceModel model : faceModelRepository.findAllByUserId(userId)) {
            Instant purgeAt = purgeAt(model.getDeletedAt());
            modelPurgeAt.put(model.getId(), purgeAt);
            put(keys, model.getMeshObjectKey(), SOURCE_FACE_MODEL, purgeAt);
            put(keys, model.getSourceMeshObjectKey(), SOURCE_FACE_MODEL, purgeAt);
            put(keys, model.getRigObjectKey(), SOURCE_FACE_MODEL, purgeAt);
            put(keys, model.getSourceRigObjectKey(), SOURCE_FACE_MODEL, purgeAt);
            put(keys, model.getExpressionObjectKey(), SOURCE_FACE_MODEL, purgeAt);
            put(keys, model.getTextureObjectKey(), SOURCE_FACE_MODEL, purgeAt);
            put(keys, model.getThumbnailObjectKey(), SOURCE_FACE_MODEL, purgeAt);
        }
        for (FaceCaptureImage image : captureImageRepository.findAllByUserId(userId)) {
            put(
                    keys,
                    image.getObjectKey(),
                    SOURCE_FACE_CAPTURE_IMAGE,
                    modelPurgeAt.get(image.getFaceModelId()));
        }
        for (Object[] row : adminRepository.findStageLogKeysByUserId(userId)) {
            put(keys, (String) row[0], SOURCE_JOB_STAGE_LOG, null);
        }
        return keys;
    }

    private static void put(
            Map<String, DbKey> keys, String key, String source, Instant deleteScheduledAt) {
        if (key != null && !key.isBlank()) {
            keys.putIfAbsent(key, new DbKey(source, deleteScheduledAt));
        }
    }

    private Instant purgeAt(Instant deletedAt) {
        return deletedAt == null ? null : deletedAt.plus(softDeleteRetention);
    }

    private Map<String, Long> simulationCounts(List<FaceModelRow> rows) {
        if (rows.isEmpty()) {
            return Map.of();
        }
        Map<String, Long> counts = new HashMap<>();
        for (Object[] row :
                adminRepository.countSimulationsByFaceModelIds(
                        rows.stream().map(FaceModelRow::getFaceModelId).toList())) {
            counts.put((String) row[0], ((Number) row[1]).longValue());
        }
        return counts;
    }

    private static void requireUserId(String userId) {
        if (userId == null || !USER_ID.matcher(userId).matches()) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST, "userId must be uuid");
        }
    }
}
