package com.preface.api.share.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.preface.api.hair.dto.HairSuggestion;
import com.preface.api.hair.dto.HairTemplateListResponse;
import com.preface.api.reconstruction.service.ReconstructionStorage.PresignedUrl;
import com.preface.api.share.dto.ShareViewResponse;
import com.preface.api.simulation.dto.EyeReview;
import com.preface.api.simulation.service.EyeEditService;
import com.preface.common.error.BusinessException;
import com.preface.common.error.ShareErrorCode;
import com.preface.common.facemodel.entity.FaceModel;
import com.preface.common.share.entity.SimulationShare;
import com.preface.common.share.repository.SimulationShareRepository;
import com.preface.common.simulation.entity.Simulation;
import com.preface.common.simulation.repository.SimulationRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.test.util.ReflectionTestUtils;

class ShareViewTest {

    static final String USER = "user-1";
    static final String SIM = "sim-1";
    static final String MODEL = "model-1";
    static final Instant NOW = Instant.parse("2026-11-20T00:00:00Z");
    static final Instant URL_EXPIRES = NOW.plusSeconds(600);
    static final String STATE =
            "{\"schemaVersion\":\"v1\",\"weights\":{\"nose.bridge_height\":0.3},"
                    + "\"pointStrokes\":[{\"vertex\":12,\"delta\":[0.1,0.0,0.0]}]}";

    final SimulationRepository simulations = mock(SimulationRepository.class);
    final SimulationShareRepository shares = mock(SimulationShareRepository.class);
    final ShareConsentPolicy consent = mock(ShareConsentPolicy.class);
    final ShareServiceFixtures fixtures = new ShareServiceFixtures();
    ShareService service;
    String token;
    SimulationShare share;
    Simulation simulation;
    FaceModel model;

    @BeforeEach
    void setUp() {
        service =
                fixtures.service(
                        simulations,
                        shares,
                        consent,
                        new ShareProperties("https://p.example", "2026-11-v1", Duration.ofDays(7)),
                        Clock.fixed(NOW, ZoneOffset.UTC));
        token = ShareToken.generate();
        share =
                SimulationShare.create(
                        USER,
                        SIM,
                        MODEL,
                        ShareToken.hash(token),
                        STATE,
                        null,
                        null,
                        null,
                        NOW.plus(Duration.ofDays(7)));
        simulation = Simulation.create(USER, MODEL, "시안", "{}");
        ReflectionTestUtils.setField(simulation, "id", SIM);
        model = mock(FaceModel.class);
        when(model.getMeshObjectKey()).thenReturn("users/u/models/j/mesh.glb");
        when(model.getRigObjectKey()).thenReturn("users/u/models/j/rig.bin");
        when(model.getTextureObjectKey()).thenReturn(null);
        when(model.getMeshFormat()).thenReturn("GLB");
        when(model.getHairMetaJson()).thenReturn("{\"rgb\":\"#332211\"}");
        when(shares.findByTokenHash(ShareToken.hash(token))).thenReturn(Optional.of(share));
        when(simulations.findById(SIM)).thenReturn(Optional.of(simulation));
        when(fixtures.faceModels.findById(MODEL)).thenReturn(Optional.of(model));
        when(consent.stillPublic(USER)).thenReturn(true);
        when(fixtures.storage.presignGet(anyString()))
                .thenAnswer(
                        inv ->
                                new PresignedUrl(
                                        "https://signed/" + inv.getArgument(0),
                                        Map.of(),
                                        URL_EXPIRES));
        when(fixtures.eyeEdit.support(MODEL))
                .thenReturn(
                        new EyeEditService.Support(new EyeReview("absent", "present"), null, null));
    }

    @Test
    void 열린_공유는_스냅숏과_새_presigned_URL을_준다() {
        ShareViewResponse res = service.view(token);

        assertThat(res.meshUrl()).isEqualTo("https://signed/users/u/models/j/mesh.glb");
        assertThat(res.rigUrl()).isEqualTo("https://signed/users/u/models/j/rig.bin");
        assertThat(res.textureUrl()).isNull();
        assertThat(res.meshFormat()).isEqualTo("GLB");
        assertThat(res.morphState().weights()).containsEntry("nose.bridge_height", 0.3);
        assertThat(res.morphState().pointStrokes()).hasSize(1);
        assertThat(res.expiresAt()).isEqualTo(NOW.plus(Duration.ofDays(7)));
        assertThat(res.urlExpiresAt()).isEqualTo(URL_EXPIRES);
        assertThat(res.toString()).doesNotContain("https://signed");
    }

    @Test
    void 눈_판정과_헤어를_함께_준다() {
        ReflectionTestUtils.setField(share, "hairTemplateId", "short-bangs");
        HairTemplateListResponse.Item item =
                new HairTemplateListResponse.Item(
                        "short-bangs",
                        "짧은 앞머리",
                        "m",
                        "b",
                        "t",
                        "gnm-v3",
                        "short",
                        "full",
                        "none",
                        "#202020");
        when(fixtures.hairTemplates.item("short-bangs")).thenReturn(Optional.of(item));
        when(fixtures.hairTemplates.suggest("{\"rgb\":\"#332211\"}"))
                .thenReturn(new HairSuggestion(null, null, null, null, "#332211", null));

        ShareViewResponse res = service.view(token);

        assertThat(res.eyeReview()).isEqualTo(new EyeReview("absent", "present"));
        assertThat(res.hair().template()).isEqualTo(item);
        assertThat(res.hair().targetRgb()).isEqualTo("#332211");
    }

    @Test
    void 보내는_사람_이름을_적었으면_주고_로그에는_가린다() {
        ReflectionTestUtils.setField(share, "senderName", "민트초코");

        ShareViewResponse res = service.view(token);

        assertThat(res.senderName()).isEqualTo("민트초코");
        assertThat(res.toString()).doesNotContain("민트초코");
    }

    @Test
    void 보내는_사람_이름을_적지_않았으면_null이다() {
        assertThat(service.view(token).senderName()).isNull();
    }

    @Test
    void 헤어가_없으면_null이다() {
        assertThat(service.view(token).hair()).isNull();
        assertThat(service.view(token).hairAssetId()).isNull();
    }

    @Test
    void 공유_시점_웹_헤어_ID를_준다() {
        ReflectionTestUtils.setField(share, "hairAssetId", "dandy");

        assertThat(service.view(token).hairAssetId()).isEqualTo("dandy");
    }

    @Test
    void 스냅숏의_가중치_점_편집_눈_편집이_응답_JSON까지_그대로_간다() {
        // S15P31B204-842: 받은 사람 화면이 편집실과 같은 키(weights 코드·pointStrokes·eyeEdit.L/R)로 받는지 확인한다
        String edited =
                "{\"schemaVersion\":\"v1\",\"weights\":{\"nose.bridge_height\":0.3,"
                        + "\"contour.weight_shape\":-0.4},"
                        + "\"pointStrokes\":[{\"vertex\":12,\"delta\":[0.1,0.0,0.0]}],"
                        + "\"eyeEdit\":{\"L\":{\"enabled\":true,\"style\":\"inout\",\"values\":"
                        + "{\"height\":30,\"crease\":65,\"inner\":0,\"outer\":0,\"lower\":0,"
                        + "\"upper\":0},\"curve\":[0.1,0.1,0.1,0.1,0.1]},\"R\":{\"enabled\":false,"
                        + "\"style\":\"inout\",\"values\":{\"height\":20,\"crease\":65,\"inner\":0,"
                        + "\"outer\":0,\"lower\":0,\"upper\":0},\"curve\":[0.1,0.1,0.1,0.1,0.1]}}}";
        ReflectionTestUtils.setField(share, "morphState", edited);

        var json =
                tools.jackson.databind.json.JsonMapper.builder()
                        .build()
                        .readTree(
                                tools.jackson.databind.json.JsonMapper.builder()
                                        .build()
                                        .writeValueAsString(service.view(token).morphState()));

        assertThat(json.get("weights").get("nose.bridge_height").asDouble()).isEqualTo(0.3);
        assertThat(json.get("weights").get("contour.weight_shape").asDouble()).isEqualTo(-0.4);
        assertThat(json.get("pointStrokes").get(0).get("vertex").asInt()).isEqualTo(12);
        assertThat(json.get("eyeEdit").get("L").get("enabled").asBoolean()).isTrue();
        assertThat(json.get("eyeEdit").get("L").get("values").get("height").asDouble())
                .isEqualTo(30);
        assertThat(json.get("eyeEdit").get("R").get("enabled").asBoolean()).isFalse();
    }

    static Stream<Arguments> unavailable() {
        return Stream.of(
                Arguments.of("없는 링크", (Consumer<ShareViewTest>) t -> t.whenNoShare()),
                Arguments.of("끝난 공유", (Consumer<ShareViewTest>) t -> t.share.revoke(NOW)),
                Arguments.of(
                        "만료",
                        (Consumer<ShareViewTest>)
                                t -> ReflectionTestUtils.setField(t.share, "expiresAt", NOW)),
                Arguments.of(
                        "시안 소프트 삭제", (Consumer<ShareViewTest>) t -> t.simulation.softDelete(NOW)),
                Arguments.of(
                        "시안 없음",
                        (Consumer<ShareViewTest>)
                                t ->
                                        when(t.simulations.findById(SIM))
                                                .thenReturn(Optional.empty())),
                Arguments.of(
                        "모델 소프트 삭제",
                        (Consumer<ShareViewTest>) t -> when(t.model.isDeleted()).thenReturn(true)),
                Arguments.of(
                        "탈퇴·공개 동의 철회",
                        (Consumer<ShareViewTest>)
                                t -> when(t.consent.stillPublic(USER)).thenReturn(false)));
    }

    void whenNoShare() {
        when(shares.findByTokenHash(ShareToken.hash(token))).thenReturn(Optional.empty());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("unavailable")
    void 실패_이유와_상관없이_같은_SHR_001이다(String reason, Consumer<ShareViewTest> arrange) {
        arrange.accept(this);

        assertThatThrownBy(() -> service.view(token))
                .extracting(e -> ((BusinessException) e).errorCode())
                .isEqualTo(ShareErrorCode.LINK_UNAVAILABLE);
    }

    @Test
    void 형식이_틀린_토큰도_SHR_001이다() {
        for (String bad : new String[] {"", "a/b", "x".repeat(1000)}) {
            assertThatThrownBy(() -> service.view(bad))
                    .extracting(e -> ((BusinessException) e).errorCode())
                    .isEqualTo(ShareErrorCode.LINK_UNAVAILABLE);
        }
        verify(shares, never()).findByTokenHash(anyString());
    }
}
