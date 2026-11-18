package com.preface.api.share.service;

import com.preface.api.hair.dto.HairSuggestion;
import com.preface.api.hair.service.HairTemplateService;
import com.preface.api.reconstruction.service.ReconstructionStorage;
import com.preface.api.reconstruction.service.ReconstructionStorage.PresignedUrl;
import com.preface.api.share.dto.ShareCreateResponse;
import com.preface.api.share.dto.ShareHair;
import com.preface.api.share.dto.ShareSummary;
import com.preface.api.share.dto.ShareViewResponse;
import com.preface.api.simulation.service.EyeEditService;
import com.preface.api.simulation.service.MorphStateCodec;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ShareErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import com.preface.common.share.entity.SimulationShare;
import com.preface.common.share.repository.SimulationShareRepository;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 시안 공유 링크(API-SHR, S15P31B204-574, 설계 docs/design/simulation-share.md).
 *
 * <p>공유는 만들 때의 {@code morph_state}·헤어를 스냅숏으로 복사한다. 토큰 원문은 응답에 한 번만 담고 DB에는 해시만 둔다. 토큰·링크는 로그에 남기지
 * 않는다.
 */
@Service
@RequiredArgsConstructor
public class ShareService {

    private final SimulationRepository simulationRepository;
    private final SimulationShareRepository shareRepository;
    private final ShareConsentPolicy consentPolicy;
    private final ShareProperties properties;
    private final Clock clock;
    private final FaceModelRepository faceModelRepository;
    private final ReconstructionStorage storage;
    private final EyeEditService eyeEditService;
    private final HairTemplateService hairTemplateService;
    private final MorphStateCodec codec;

    /**
     * API-SHR-01. 판정 순서: 본인 시안(404) → 보내는 사람 이름(COMMON_001) → 빈 시안(SHR_002) → 공개 동의(SHR_003).
     *
     * @param hairAssetId 편집실에서 씌워 둔 웹 헤어 ID(선택, S15P31B204-842). 편집실 헤어는 서버에 저장하지 않아 만들 때 받는다
     * @param senderName 받는 사람에게 보일 이름(선택, S15P31B204-843). 공유한 사람이 직접 적은 값만 받는다
     */
    @Transactional
    public ShareCreateResponse create(
            String userId, String simulationId, String hairAssetId, String senderName) {
        Simulation simulation = ownedSimulation(userId, simulationId);
        String name = ShareSenderName.normalize(senderName);
        if (!simulation.isHasChanges()) {
            throw new BusinessException(ShareErrorCode.EMPTY_SIMULATION);
        }
        if (!consentPolicy.canShare(userId)) {
            throw new BusinessException(ShareErrorCode.CONSENT_REQUIRED);
        }
        String token = ShareToken.generate();
        Instant expiresAt = clock.instant().plus(properties.ttl());
        SimulationShare share =
                shareRepository.save(
                        SimulationShare.create(
                                userId,
                                simulation.getId(),
                                simulation.getFaceModelId(),
                                ShareToken.hash(token),
                                simulation.getMorphState(),
                                simulation.getHairTemplateId(),
                                hairAssetId,
                                name,
                                expiresAt));
        return new ShareCreateResponse(
                share.getId(), properties.webBaseUrl() + "/s/" + token, expiresAt);
    }

    /** API-SHR-02. 최신순. */
    @Transactional(readOnly = true)
    public List<ShareSummary> list(String userId, String simulationId) {
        Simulation simulation = ownedSimulation(userId, simulationId);
        return shareRepository
                .findAllBySimulationIdOrderByCreatedAtDesc(simulation.getId())
                .stream()
                .map(
                        s ->
                                new ShareSummary(
                                        s.getId(),
                                        s.getCreatedAt(),
                                        s.getExpiresAt(),
                                        s.getRevokedAt()))
                .toList();
    }

    /** API-SHR-03. 이미 끝났어도 성공(멱등). */
    @Transactional
    public void revoke(String userId, String shareId) {
        shareRepository
                .findByIdAndUserId(shareId, userId)
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND))
                .revoke(clock.instant());
    }

    /**
     * API-SHR-04(인증 없음). 실패 이유(형식·없음·끝남·만료·시안/모델 삭제·탈퇴·동의 철회)와 상관없이 같은 {@code SHR_001}이다 — 링크가 있었는지
     * 추측하지 못하게 한다.
     */
    @Transactional(readOnly = true)
    public ShareViewResponse view(String token) {
        if (!ShareToken.wellFormed(token)) {
            throw unavailable();
        }
        SimulationShare share =
                shareRepository
                        .findByTokenHash(ShareToken.hash(token))
                        .filter(s -> s.isOpen(clock.instant()))
                        .orElseThrow(ShareService::unavailable);
        boolean simulationAlive =
                simulationRepository
                        .findById(share.getSimulationId())
                        .map(s -> s.getDeletedAt() == null)
                        .orElse(false);
        FaceModel model =
                faceModelRepository
                        .findById(share.getFaceModelId())
                        .filter(m -> !m.isDeleted())
                        .orElse(null);
        if (!simulationAlive || model == null || !consentPolicy.stillPublic(share.getUserId())) {
            throw unavailable();
        }
        PresignedUrl mesh = storage.presignGet(model.getMeshObjectKey());
        return new ShareViewResponse(
                mesh.url(),
                urlOrNull(model.getRigObjectKey()),
                urlOrNull(model.getTextureObjectKey()),
                model.getMeshFormat(),
                codec.read(share.getMorphState()),
                eyeEditService.support(share.getFaceModelId()).review(),
                hair(share, model),
                share.getHairAssetId(),
                share.getSenderName(),
                share.getExpiresAt(),
                mesh.expiresAt());
    }

    private ShareHair hair(SimulationShare share, FaceModel model) {
        if (share.getHairTemplateId() == null) {
            return null;
        }
        HairSuggestion suggestion = hairTemplateService.suggest(model.getHairMetaJson());
        String targetRgb = suggestion == null ? null : suggestion.rgb();
        return hairTemplateService
                .item(share.getHairTemplateId())
                .map(item -> new ShareHair(item, targetRgb))
                .orElse(null);
    }

    private String urlOrNull(String objectKey) {
        return objectKey == null ? null : storage.presignGet(objectKey).url();
    }

    private static BusinessException unavailable() {
        return new BusinessException(ShareErrorCode.LINK_UNAVAILABLE);
    }

    private Simulation ownedSimulation(String userId, String simulationId) {
        return simulationRepository
                .findByIdAndUserIdAndDeletedAtIsNull(simulationId, userId)
                .orElseThrow(() -> new BusinessException(CommonErrorCode.NOT_FOUND));
    }
}
