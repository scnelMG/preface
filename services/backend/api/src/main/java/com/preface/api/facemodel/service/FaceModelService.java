package com.preface.api.facemodel.service;

import com.preface.api.facemodel.dto.FaceModelDeleteResponse;
import com.preface.api.facemodel.dto.FaceModelDetailResponse;
import com.preface.api.facemodel.dto.FaceModelListResponse;
import com.preface.api.facemodel.dto.FaceModelTitleResponse;
import com.preface.api.facemodel.dto.ThumbnailSaveRequest;
import com.preface.api.facemodel.dto.ThumbnailSaveResponse;
import com.preface.api.facemodel.dto.ThumbnailUploadRequest;
import com.preface.api.facemodel.dto.ThumbnailUploadResponse;
import com.preface.api.hair.service.HairTemplateService;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.reconstruction.service.ReconstructionStorage.PresignedUrl;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.HistoryErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.facereading.repository.FaceReadingRepository;
import com.preface.common.reconstruction.ReconstructionOutputKeys;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 내 머리(3D) 목록·상세·삭제(API-HIS-01·02·03).
 *
 * <p>파일은 Spring이 중계하지 않고 presigned GET(10분)만 내린다. 서명 URL은 로그에 남기지 않는다. 삭제는 소프트 삭제({@code
 * deleted_at})까지만 하고, 30일 뒤 물리·S3 삭제는 삭제 배치(FN-HIS-03 수용 3)가 맡는다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FaceModelService {

    /** 내 머리 이름 최대 길이(앞뒤 공백 제거 뒤). DB 칼럼은 100자지만 팀장 확정 화면 기준으로 20자로 막는다. */
    static final int MAX_TITLE = 20;

    static final int MAX_PAGE_SIZE = 50;

    /** 썸네일은 투명 배경 WebP(작업실 렌더, 기본 모델 그림 -437과 같은 형식). */
    private static final String THUMBNAIL_TYPE = "image/webp";

    private final FaceModelRepository faceModelRepository;
    private final SimulationRepository simulationRepository;
    private final FaceReadingRepository faceReadingRepository;
    private final ReconstructionStorage storage;
    private final Clock clock;
    private final HairTemplateService hairTemplateService;

    /** API-HIS-01. 최신순(같은 시각이면 ID 내림차순). */
    public FaceModelListResponse list(String userId, int page, int size) {
        int safePage = Math.max(page, 0);
        int safeSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
        Page<FaceModel> result =
                faceModelRepository.findByUserIdAndDeletedAtIsNull(
                        userId,
                        PageRequest.of(
                                safePage,
                                safeSize,
                                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        Map<String, Long> counts = simulationCounts(result.getContent());
        List<FaceModelListResponse.Item> items =
                result.getContent().stream()
                        .map(
                                m ->
                                        new FaceModelListResponse.Item(
                                                m.getId(),
                                                m.getTitle(),
                                                urlOrNull(m.getThumbnailObjectKey()),
                                                m.getCreatedAt(),
                                                counts.getOrDefault(m.getId(), 0L)))
                        .toList();
        return new FaceModelListResponse(items, safePage, safeSize, result.getTotalElements());
    }

    /** API-HIS-02. 없거나 남의 것·삭제된 것이면 COMMON_002. */
    public FaceModelDetailResponse detail(String userId, String faceModelId) {
        FaceModel model =
                faceModelRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(faceModelId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        PresignedUrl mesh = storage.presignGet(model.getMeshObjectKey());
        return new FaceModelDetailResponse(
                model.getId(),
                mesh.url(),
                urlOrNull(model.getRigObjectKey()),
                urlOrNull(currentExpressionKey(model)),
                urlOrNull(model.getTextureObjectKey()),
                model.getMeshFormat(),
                model.getMorphSchemaVersion(),
                mesh.expiresAt(),
                model.getCreatedAt(),
                hairTemplateService.suggest(model.getHairMetaJson()));
    }

    /**
     * 내 머리 이름 바꾸기(S15P31B204-399, 명세 반영 전 가칭 API-HIS-08). 1~20자(팀장 확정), 오류 코드는 시안 이름(API-HIS-05)과
     * 같다. 삭제(API-HIS-03)와 같은 행 잠금으로 동시에 온 삭제와 한 줄로 세운다 — 삭제가 먼저 끝나면 COMMON_002.
     */
    @Transactional
    public FaceModelTitleResponse rename(String userId, String faceModelId, String title) {
        String trimmed = title == null ? "" : title.strip();
        if (trimmed.isEmpty() || trimmed.length() > MAX_TITLE) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST, "title must be 1~20");
        }
        FaceModel model =
                faceModelRepository
                        .findOwnedForUpdate(faceModelId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        model.rename(trimmed);
        faceModelRepository.flush(); // updatedAt(@LastModifiedDate)을 응답에 싣는다
        return new FaceModelTitleResponse(model.getId(), model.getTitle(), model.getUpdatedAt());
    }

    /**
     * 내 머리 썸네일 업로드 URL(S15P31B204-436, 가안). GPU 워커가 썸네일을 만들지 않아, 작업실이 원본 3D를 정면으로 렌더링한 WebP를 올린다.
     * 이미 썸네일이 있으면 HIS_010. key는 GPU 시도 경로와 겹치지 않게 모델 폴더 바로 아래에 둔다(3D 삭제 때 함께 지워진다).
     */
    @Transactional(readOnly = true)
    public ThumbnailUploadResponse thumbnailUploadUrl(
            String userId, String faceModelId, ThumbnailUploadRequest request) {
        FaceModel model =
                faceModelRepository
                        .findByIdAndUserIdAndDeletedAtIsNull(faceModelId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        if (model.getThumbnailObjectKey() != null) {
            throw new BusinessException(HistoryErrorCode.THUMBNAIL_EXISTS);
        }
        String key = thumbnailKey(model);
        PresignedUrl put =
                storage.presignPut(
                        key, THUMBNAIL_TYPE, request.sizeBytes(), request.checksumSha256());
        return new ThumbnailUploadResponse(key, put.url(), put.headers(), put.expiresAt());
    }

    /** 올린 썸네일 확인 후 저장. 비어 있을 때만 채우고(먼저 저장된 것 유지), 저장된 썸네일 주소를 돌려준다. */
    @Transactional
    public ThumbnailSaveResponse saveThumbnail(
            String userId, String faceModelId, ThumbnailSaveRequest request) {
        FaceModel model =
                faceModelRepository
                        .findOwnedForUpdate(faceModelId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        if (model.getThumbnailObjectKey() == null) {
            if (!thumbnailKey(model).equals(request.objectKey())
                    || storage.checkUpload(
                                    request.objectKey(),
                                    request.sizeBytes(),
                                    request.checksumSha256())
                            != ReconstructionStorage.UploadCheck.PRESENT) {
                throw new BusinessException(HistoryErrorCode.THUMBNAIL_NOT_UPLOADED);
            }
            model.attachThumbnail(request.objectKey());
        }
        return new ThumbnailSaveResponse(
                model.getId(), storage.presignGet(model.getThumbnailObjectKey()).url());
    }

    static String thumbnailKey(FaceModel model) {
        return "users/"
                + model.getUserId()
                + "/models/"
                + model.getReconstructionJobId()
                + "/thumbnail-web.webp";
    }

    /**
     * API-HIS-03. 3D와 연결 시안(빈 시안 포함)을 같은 시각으로 소프트 삭제한다(FN-HIS-03 수용 1·2). 이미 지운 3D는 없는 것으로
     * 본다(COMMON_002).
     */
    @Transactional
    public FaceModelDeleteResponse delete(String userId, String faceModelId) {
        FaceModel model =
                faceModelRepository
                        .findOwnedForUpdate(faceModelId, userId)
                        .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
        Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        model.softDelete(now);
        simulationRepository.softDeleteByFaceModelId(model.getId(), now);
        // AI 관상(-438)은 3D와 함께 바로 지운다. 결과 글만 있어 30일 보관할 이유가 없다
        faceReadingRepository.deleteByReconstructionJobId(model.getReconstructionJobId());
        return FaceModelDeleteResponse.pending();
    }

    private Map<String, Long> simulationCounts(List<FaceModel> models) {
        if (models.isEmpty()) {
            return Map.of();
        }
        Map<String, Long> counts = new HashMap<>();
        for (Object[] row :
                simulationRepository.countVisibleByFaceModelIds(
                        models.stream().map(FaceModel::getId).toList())) {
            counts.put((String) row[0], ((Number) row[1]).longValue());
        }
        return counts;
    }

    /** 지금 메시에 맞는 표정 리그 key. 메시가 다른 폴더로 바뀌었으면 옛 메시용이라 주지 않는다(null). key는 삭제 추적을 위해 모델에 그대로 남는다. */
    private static String currentExpressionKey(FaceModel model) {
        String key = model.getExpressionObjectKey();
        return key != null
                        && key.equals(
                                ReconstructionOutputKeys.expressionBeside(model.getMeshObjectKey()))
                ? key
                : null;
    }

    private String urlOrNull(String objectKey) {
        return objectKey == null ? null : storage.presignGet(objectKey).url();
    }
}
