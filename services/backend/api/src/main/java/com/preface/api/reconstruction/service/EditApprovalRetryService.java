package com.preface.api.reconstruction.service;

import com.preface.api.reconstruction.dto.EyeApprovalRequest;
import com.preface.api.reconstruction.dto.NoseApprovalRequest;
import com.preface.common.error.BusinessException;
import com.preface.common.error.ReconstructionErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.facemodel.repository.FaceModelRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** 보관한 승인 후보로 같은 모델을 다시 검사한다. 검사기 요청 중에는 DB 잠금을 잡지 않는다. */
@Service
@EnableScheduling
@RequiredArgsConstructor
@Slf4j
class EditApprovalRetryService {
    private static final int MAX_FAILURES = 5;

    private final FaceModelRepository models;
    private final NoseModelApproval noseApproval;
    private final EyeModelApproval eyeApproval;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final JsonMapper json;

    record Candidate(
            String mesh,
            String rig,
            String eyeParts,
            String eyeReview,
            NoseApprovalRequest nose,
            EyeApprovalRequest eye,
            int failures) {}

    record Attempt<T>(T value, boolean retry) {}

    static <T> Attempt<T> attempt(Supplier<T> verify) {
        try {
            return new Attempt<>(verify.get(), false);
        } catch (BusinessException e) {
            if (e.errorCode() == ReconstructionErrorCode.RESULT_CHECK_UNAVAILABLE)
                return new Attempt<>(null, true);
            throw e;
        }
    }

    private record Claim(String id, Candidate candidate, Instant lease) {}

    @Scheduled(fixedDelayString = "${preface.reconstruction.edit-approval-retry-delay:5000}")
    void retryDue() {
        for (String id : models.findDueEditApprovalRetries(clock.instant(), PageRequest.of(0, 4))) {
            Claim claim = transactions.execute(tx -> claim(id));
            if (claim == null) continue;
            Candidate candidate = claim.candidate();
            Attempt<String> nose =
                    recover(
                            () ->
                                    candidate.nose() == null
                                            ? null
                                            : noseApproval.validateForGeneration(
                                                    candidate.mesh(),
                                                    candidate.rig(),
                                                    candidate.nose()));
            Attempt<Boolean> eye =
                    recover(
                            () ->
                                    candidate.eye() != null
                                            && eyeApproval.verifyAssets(
                                                    candidate.mesh(),
                                                    candidate.rig(),
                                                    readReview(candidate.eyeReview()),
                                                    candidate.eye()));
            transactions.executeWithoutResult(tx -> finish(claim, nose, eye));
        }
    }

    private Claim claim(String id) {
        FaceModel model = models.findByIdAndDeletedAtIsNull(id).orElse(null);
        Instant now = clock.instant();
        if (model == null
                || model.getEditApprovalRetryAt() == null
                || model.getEditApprovalRetryAt().isAfter(now)) return null;
        Candidate candidate = json.readValue(model.getEditApprovalRetry(), Candidate.class);
        if (!matches(model, candidate)) {
            model.scheduleEditApprovalRetry(null, null);
            return null;
        }
        // 최악의 코·눈 HTTP 왕복(12 x 48초)보다 길게 잡고, 프로세스가 꺼지면 만료 뒤 복구한다.
        Instant lease = now.plusSeconds(900).truncatedTo(ChronoUnit.MILLIS);
        model.scheduleEditApprovalRetry(model.getEditApprovalRetry(), lease);
        return new Claim(id, candidate, lease);
    }

    private void finish(Claim claim, Attempt<String> nose, Attempt<Boolean> eye) {
        FaceModel model = models.findByIdAndDeletedAtIsNull(claim.id()).orElse(null);
        if (model == null || !claim.lease().equals(model.getEditApprovalRetryAt())) return;
        Candidate candidate = claim.candidate();
        if (!matches(model, candidate)) {
            model.scheduleEditApprovalRetry(null, null);
            return;
        }
        if (nose.value() != null && model.getApprovedNoseCapabilities() == null)
            model.approveNose(nose.value());
        if (Boolean.TRUE.equals(eye.value()) && model.getApprovedEyeCapabilities() == null)
            eyeApproval.approveWithVerifiedAssets(model.getId(), candidate.eye());
        NoseApprovalRequest pendingNose =
                nose.retry() && model.getApprovedNoseCapabilities() == null
                        ? candidate.nose()
                        : null;
        EyeApprovalRequest pendingEye =
                eye.retry() && model.getApprovedEyeCapabilities() == null ? candidate.eye() : null;
        int failures = candidate.failures() + 1;
        if ((pendingNose != null || pendingEye != null) && failures < MAX_FAILURES) {
            model.scheduleEditApprovalRetry(
                    json.writeValueAsString(
                            new Candidate(
                                    candidate.mesh(),
                                    candidate.rig(),
                                    candidate.eyeParts(),
                                    candidate.eyeReview(),
                                    pendingNose,
                                    pendingEye,
                                    failures)),
                    clock.instant().plusSeconds(15L << failures));
        } else {
            model.scheduleEditApprovalRetry(null, null);
        }
    }

    private boolean matches(FaceModel model, Candidate candidate) {
        return Objects.equals(model.getMeshObjectKey(), candidate.mesh())
                && Objects.equals(model.getRigObjectKey(), candidate.rig())
                && Objects.equals(model.getEyePartsSha256(), candidate.eyeParts())
                && Objects.equals(
                        readReview(model.getEyeReview()), readReview(candidate.eyeReview()));
    }

    private Map<String, String> readReview(String value) {
        if (value == null) return null;
        var review = json.readTree(value);
        return Map.of("L", review.path("L").asText(), "R", review.path("R").asText());
    }

    private static <T> Attempt<T> recover(Supplier<T> verify) {
        try {
            return attempt(verify);
        } catch (BusinessException e) {
            log.info("stored edit candidate rejected: {}", e.errorCode().code());
            return new Attempt<>(null, false);
        }
    }
}
