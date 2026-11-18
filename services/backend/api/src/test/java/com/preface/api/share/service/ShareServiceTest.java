package com.preface.api.share.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.share.dto.ShareCreateResponse;
import com.preface.api.share.dto.ShareSummary;
import com.preface.common.error.BusinessException;
import com.preface.common.error.CommonErrorCode;
import com.preface.common.error.ShareErrorCode;
import com.preface.common.share.entity.SimulationShare;
import com.preface.common.share.repository.SimulationShareRepository;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

class ShareServiceTest {

    static final String USER = "user-1";
    static final String SIM = "sim-1";
    static final String MODEL = "model-1";
    static final Instant NOW = Instant.parse("2026-11-20T00:00:00Z");
    static final String STATE =
            "{\"schemaVersion\":\"v1\",\"weights\":{\"nose.bridge_height\":0.3},"
                    + "\"pointStrokes\":[{\"vertex\":12,\"delta\":[0.1,0,0]}]}";

    final SimulationRepository simulations = mock(SimulationRepository.class);
    final SimulationShareRepository shares = mock(SimulationShareRepository.class);
    final ShareConsentPolicy consent = mock(ShareConsentPolicy.class);
    final ShareProperties properties =
            new ShareProperties("https://preface.example/", "2026-11-v1", Duration.ofDays(7));
    final ShareServiceFixtures fixtures = new ShareServiceFixtures();
    ShareService service;
    Simulation simulation;

    @BeforeEach
    void setUp() {
        service =
                fixtures.service(
                        simulations, shares, consent, properties, Clock.fixed(NOW, ZoneOffset.UTC));
        simulation = Simulation.create(USER, MODEL, "시안", STATE);
        ReflectionTestUtils.setField(simulation, "id", SIM);
        ReflectionTestUtils.setField(simulation, "hasChanges", true);
        when(simulations.findByIdAndUserIdAndDeletedAtIsNull(SIM, USER))
                .thenReturn(Optional.of(simulation));
        when(consent.canShare(USER)).thenReturn(true);
        when(shares.save(any(SimulationShare.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    SimulationShare saved() {
        ArgumentCaptor<SimulationShare> captor = ArgumentCaptor.forClass(SimulationShare.class);
        verify(shares).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void 남의_시안이면_COMMON_002다() {
        assertThatThrownBy(() -> service.create("other", SIM, null, null))
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(CommonErrorCode.NOT_FOUND);
    }

    @Test
    void 빈_시안이면_SHR_002다() {
        ReflectionTestUtils.setField(simulation, "hasChanges", false);

        assertThatThrownBy(() -> service.create(USER, SIM, null, null))
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(ShareErrorCode.EMPTY_SIMULATION);
    }

    @Test
    void 공개_동의가_없으면_SHR_003이다() {
        when(consent.canShare(USER)).thenReturn(false);

        assertThatThrownBy(() -> service.create(USER, SIM, null, null))
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(ShareErrorCode.CONSENT_REQUIRED);
    }

    @Test
    void 공유를_만들면_해시만_저장하고_URL에_토큰을_담는다() {
        ShareCreateResponse res = service.create(USER, SIM, null, null);

        assertThat(res.shareUrl()).startsWith("https://preface.example/s/");
        String token = res.shareUrl().substring("https://preface.example/s/".length());
        SimulationShare share = saved();
        assertThat(share.getTokenHash()).isEqualTo(ShareToken.hash(token));
        assertThat(share.getUserId()).isEqualTo(USER);
        assertThat(share.getFaceModelId()).isEqualTo(MODEL);
        assertThat(share.getExpiresAt()).isEqualTo(NOW.plus(Duration.ofDays(7)));
        assertThat(res.expiresAt()).isEqualTo(NOW.plus(Duration.ofDays(7)));
        assertThat(res.toString()).doesNotContain(token);
    }

    @Test
    void 공유_뒤_시안을_바꿔도_스냅숏은_그대로다() {
        service.create(USER, SIM, null, null);
        simulation.moveTo("{\"schemaVersion\":\"v1\",\"weights\":{}}", 1);

        assertThat(saved().getMorphState()).isEqualTo(STATE);
    }

    @Test
    void 헤어도_공유_시점_값으로_복사한다() {
        simulation.applyHair("short-bangs");

        service.create(USER, SIM, null, null);
        simulation.applyHair(null);

        assertThat(saved().getHairTemplateId()).isEqualTo("short-bangs");
    }

    @Test
    void 편집실_웹_헤어를_공유_시점_값으로_남긴다() {
        service.create(USER, SIM, "dandy", null);

        assertThat(saved().getHairAssetId()).isEqualTo("dandy");
    }

    @Test
    void 웹_헤어가_없으면_비워_둔다() {
        service.create(USER, SIM, null, null);

        assertThat(saved().getHairAssetId()).isNull();
    }

    @Test
    void 보내는_사람_이름은_앞뒤_공백을_지워_저장한다() {
        service.create(USER, SIM, null, "  민트초코  ");

        assertThat(saved().getSenderName()).isEqualTo("민트초코");
    }

    @Test
    void 보내는_사람_이름이_비었거나_공백뿐이면_이름_없이_만든다() {
        service.create(USER, SIM, null, "   ");

        assertThat(saved().getSenderName()).isNull();
    }

    @Test
    void 보내는_사람_이름은_코드_포인트_기준_20자까지_받는다() {
        String twenty = "😀".repeat(20);

        service.create(USER, SIM, null, twenty);

        assertThat(saved().getSenderName()).isEqualTo(twenty);
    }

    @Test
    void 보내는_사람_이름이_20자를_넘으면_COMMON_001이다() {
        assertThatThrownBy(() -> service.create(USER, SIM, null, "가".repeat(21)))
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(CommonErrorCode.INVALID_REQUEST);
    }

    @Test
    void 보내는_사람_이름에_제어_문자가_있으면_COMMON_001이다() {
        for (String name : List.of("민트\n초코", "민트\u0000", "\u202E민트", "민트\u200B초코")) {
            assertThatThrownBy(() -> service.create(USER, SIM, null, name))
                    .extracting(e -> ((BusinessException) e).errorCode())
                    .isEqualTo(CommonErrorCode.INVALID_REQUEST);
        }
    }

    @Test
    void 목록은_최신순이고_토큰을_주지_않는다() {
        when(shares.findAllBySimulationIdOrderByCreatedAtDesc(SIM))
                .thenReturn(List.of(share("s2"), share("s1")));

        List<ShareSummary> list = service.list(USER, SIM);

        assertThat(list).extracting(ShareSummary::shareId).containsExactly("s2", "s1");
    }

    @Test
    void 남의_시안_목록이면_COMMON_002다() {
        assertThatThrownBy(() -> service.list("other", SIM))
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(CommonErrorCode.NOT_FOUND);
    }

    @Test
    void 남의_공유를_끝내면_COMMON_002다() {
        when(shares.findByIdAndUserId("s1", "other")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.revoke("other", "s1"))
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(CommonErrorCode.NOT_FOUND);
    }

    @Test
    void 이미_끝난_공유를_다시_끝내도_시각이_바뀌지_않는다() {
        SimulationShare share = share("s1");
        Instant first = NOW.minusSeconds(3600);
        share.revoke(first);
        when(shares.findByIdAndUserId("s1", USER)).thenReturn(Optional.of(share));

        service.revoke(USER, "s1");

        assertThat(share.getRevokedAt()).isEqualTo(first);
    }

    @Test
    void 공유를_끝내면_끝낸_시각이_남는다() {
        SimulationShare share = share("s1");
        when(shares.findByIdAndUserId("s1", USER)).thenReturn(Optional.of(share));

        service.revoke(USER, "s1");

        assertThat(share.getRevokedAt()).isEqualTo(NOW);
    }

    static SimulationShare share(String id) {
        SimulationShare share =
                SimulationShare.create(
                        USER,
                        SIM,
                        MODEL,
                        "H".repeat(44),
                        STATE,
                        null,
                        null,
                        null,
                        NOW.plusSeconds(60));
        ReflectionTestUtils.setField(share, "id", id);
        return share;
    }
}
