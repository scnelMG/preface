package com.preface.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.startsWith;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.preface.ConsentFixtures;
import com.preface.TestcontainersConfiguration;
import com.preface.api.auth.service.oauth.GoogleOAuthClient;
import com.preface.api.auth.service.oauth.KakaoOAuthClient;
import com.preface.api.auth.service.oauth.OAuthProfile;
import com.preface.api.consent.service.ConsentDocumentService;
import com.preface.api.global.security.AuthProperties;
import com.preface.api.global.security.JwtProvider;
import com.preface.api.global.security.TokenScope;
import com.preface.common.consent.entity.ConsentType;
import com.preface.common.consent.repository.ConsentDocumentRepository;
import com.preface.common.user.entity.OAuthProvider;
import jakarta.servlet.http.Cookie;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * 소셜 로그인 → 가입 → 내 정보 → 재발급 → 로그아웃 전체 흐름을 실제 MySQL·Redis로 확인한다.
 *
 * <p>카카오·구글 호출만 mock으로 바꾼다(인가 코드 교환은 실제 제공자가 있어야 해서).
 */
@Tag("integration")
@ActiveProfiles("it")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AuthFlowIT {

    private static final String REDIRECT = "http://localhost:3000/oauth/kakao";

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbcTemplate;
    @Autowired AuthProperties authProperties;
    @Autowired ConsentDocumentRepository consentDocumentRepository;

    @MockitoBean KakaoOAuthClient kakao;
    @MockitoBean GoogleOAuthClient google;

    private String providerUserId;

    @BeforeEach
    void setUp() {
        providerUserId = "kakao-" + UUID.randomUUID();
        when(kakao.provider()).thenReturn(OAuthProvider.KAKAO);
        when(google.provider()).thenReturn(OAuthProvider.GOOGLE);
        when(kakao.authorizeUrl(anyString(), anyString()))
                .thenAnswer(
                        inv ->
                                "https://kauth.kakao.com/oauth/authorize?state="
                                        + inv.getArgument(1));
        when(kakao.fetchProfile(anyString(), anyString()))
                .thenAnswer(
                        inv ->
                                new OAuthProfile(
                                        OAuthProvider.KAKAO,
                                        providerUserId,
                                        "민서",
                                        "minseo@kakao.com"));
    }

    @Test
    void 신규_사용자는_가입_후_세션을_받고_재로그인하면_기존_회원으로_로그인된다() throws Exception {
        String signupToken = loginAsNew();
        assertThat(count("user")).as("동의 전에는 회원 행이 없다").isZero();

        MvcResult signup =
                signup(signupToken, currentDocumentIds())
                        .andExpect(status().isCreated())
                        .andReturn();
        String accessToken = JsonPath.read(body(signup), "$.data.accessToken");
        assertThat(refreshCookie(signup)).isNotBlank();
        assertThat(count("user")).isEqualTo(1);
        assertThat(count("user_consent")).isEqualTo(4);

        mockMvc.perform(
                        get("/api/v1/users/me")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.nickname").value("민서"))
                .andExpect(jsonPath("$.data.maskedEmail").value("m***@kakao.com"))
                .andExpect(jsonPath("$.data.providers[0]").value("KAKAO"))
                .andExpect(jsonPath("$.data.dataSummary.faceModelCount").value(0));

        String state = authorizeState();
        mockMvc.perform(loginRequest(state))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.isNewUser").value(false))
                .andExpect(jsonPath("$.data.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.data.signupToken").doesNotExist());
    }

    @Test
    void 같은_가입_토큰으로_다시_가입하면_같은_회원의_세션을_준다() throws Exception {
        String signupToken = loginAsNew();
        String first =
                JsonPath.read(
                        body(signup(signupToken, currentDocumentIds()).andReturn()),
                        "$.data.user.id");
        String second =
                JsonPath.read(
                        body(signup(signupToken, currentDocumentIds()).andReturn()),
                        "$.data.user.id");

        assertThat(second).isEqualTo(first);
        assertThat(count("user")).isEqualTo(1);
    }

    @Test
    void 동의가_빠지면_AUTH_031이고_회원이_생기지_않는다() throws Exception {
        String signupToken = loginAsNew();
        String[] ids = currentDocumentIds();

        signup(signupToken, ids[0], ids[1], ids[2])
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("AUTH_031"));
        assertThat(count("user")).isZero();
    }

    @Test
    void 가입_토큰으로_보호_API를_부르면_AUTH_024() throws Exception {
        String signupToken = loginAsNew();

        mockMvc.perform(
                        get("/api/v1/users/me")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + signupToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("AUTH_024"));
    }

    @Test
    void 토큰이_없으면_AUTH_001_만료면_AUTH_002() throws Exception {
        mockMvc.perform(get("/api/v1/users/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_001"));

        JwtProvider past =
                new JwtProvider(
                        authProperties,
                        Clock.fixed(Instant.now().minus(Duration.ofHours(1)), ZoneOffset.UTC));
        String expired = past.issue("someone", TokenScope.USER, Duration.ofMinutes(30)).value();
        mockMvc.perform(
                        get("/api/v1/users/me")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + expired))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_002"));
    }

    @Test
    void refresh는_회전하고_이전_refresh와_로그아웃한_refresh는_쓸_수_없다() throws Exception {
        MvcResult signup = signup(loginAsNew(), currentDocumentIds()).andReturn();
        String accessToken = JsonPath.read(body(signup), "$.data.accessToken");
        String refresh1 = refreshCookie(signup);

        MvcResult rotated =
                mockMvc.perform(
                                post("/api/v1/auth/token/refresh")
                                        .cookie(new Cookie("refresh_token", refresh1)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.accessToken").isNotEmpty())
                        .andReturn();
        String refresh2 = refreshCookie(rotated);
        assertThat(refresh2).isNotEqualTo(refresh1);

        mockMvc.perform(
                        post("/api/v1/auth/token/refresh")
                                .cookie(new Cookie("refresh_token", refresh1)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_003"));

        mockMvc.perform(
                        post("/api/v1/auth/logout")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                                .cookie(new Cookie("refresh_token", refresh2)))
                .andExpect(status().isOk());
        mockMvc.perform(
                        post("/api/v1/auth/token/refresh")
                                .cookie(new Cookie("refresh_token", refresh2)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_003"));
    }

    @Test
    void state가_다르거나_재사용되면_AUTH_012_허용되지_않은_redirectUri는_AUTH_011() throws Exception {
        mockMvc.perform(loginRequest("unknown-state"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("AUTH_012"));

        String state = authorizeState();
        mockMvc.perform(loginRequest(state)).andExpect(status().isOk());
        mockMvc.perform(loginRequest(state)).andExpect(jsonPath("$.error.code").value("AUTH_012"));

        mockMvc.perform(
                        get("/api/v1/auth/oauth/kakao/authorize-url")
                                .param("redirectUri", "https://evil.example/cb"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("AUTH_011"));
        mockMvc.perform(
                        get("/api/v1/auth/oauth/naver/authorize-url")
                                .param("redirectUri", REDIRECT))
                .andExpect(jsonPath("$.error.code").value("AUTH_010"));
    }

    @Test
    void 동의서_4종은_인증_없이_조회된다() throws Exception {
        mockMvc.perform(get("/api/v1/consent-documents"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data[0].consentType").value("TERMS"));
    }

    @Test
    void 얼굴_데이터_동의서_요약을_내린다() throws Exception {
        mockMvc.perform(get("/api/v1/consent-documents"))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data[?(@.consentType == 'FACE_DATA')].summary")
                                .value(hasItem(startsWith("수집: 촬영한 얼굴 영상"))));
    }

    @Test
    void 인물_사진_동의서는_시행일_전에는_기존_버전이고_이후에만_필수가_된다() {
        var before =
                new ConsentDocumentService(
                                consentDocumentRepository,
                                Clock.fixed(Instant.parse("2026-12-14T14:59:59Z"), ZoneOffset.UTC))
                        .currentByType();
        var after =
                new ConsentDocumentService(
                                consentDocumentRepository,
                                Clock.fixed(Instant.parse("2026-12-14T15:00:00Z"), ZoneOffset.UTC))
                        .currentByType();

        assertThat(before.get(ConsentType.TERMS).getVersion()).isEqualTo("2026-10-v1");
        assertThat(before.get(ConsentType.PRIVACY).getVersion()).isEqualTo("2026-10-v1");
        for (ConsentType type : new ConsentType[] {ConsentType.TERMS, ConsentType.PRIVACY}) {
            assertThat(after.get(type).getVersion()).isEqualTo("2026-12-v1");
            assertThat(after.get(type).isRequired()).isTrue();
            assertThat(after.get(type).getSummary()).contains("[인물·사진 참조 요청]");
        }
    }

    private String loginAsNew() throws Exception {
        MvcResult result =
                mockMvc.perform(loginRequest(authorizeState()))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.isNewUser").value(true))
                        .andExpect(jsonPath("$.data.profile.maskedEmail").value("m***@kakao.com"))
                        .andReturn();
        return JsonPath.read(body(result), "$.data.signupToken");
    }

    private String authorizeState() throws Exception {
        MvcResult result =
                mockMvc.perform(
                                get("/api/v1/auth/oauth/kakao/authorize-url")
                                        .param("redirectUri", REDIRECT))
                        .andExpect(status().isOk())
                        .andReturn();
        return JsonPath.read(body(result), "$.data.state");
    }

    private org.springframework.test.web.servlet.RequestBuilder loginRequest(String state) {
        return post("/api/v1/auth/oauth/kakao/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        "{\"code\":\"test-code\",\"state\":\""
                                + state
                                + "\",\"redirectUri\":\""
                                + REDIRECT
                                + "\"}");
    }

    private org.springframework.test.web.servlet.ResultActions signup(
            String signupToken, String... documentIds) throws Exception {
        StringBuilder consents = new StringBuilder();
        for (String id : documentIds) {
            if (!consents.isEmpty()) {
                consents.append(',');
            }
            consents.append("{\"consentDocumentId\":\"").append(id).append("\",\"agreed\":true}");
        }
        return mockMvc.perform(
                post("/api/v1/auth/signup")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + signupToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"consents\":[" + consents + "]}"));
    }

    private String[] currentDocumentIds() {
        return jdbcTemplate
                .queryForList(ConsentFixtures.CURRENT_DOCUMENT_IDS, String.class)
                .toArray(String[]::new);
    }

    /** 이 테스트의 소셜 계정에 연결된 행 수. 다른 테스트가 만든 회원은 세지 않는다. */
    private int count(String table) {
        String sql =
                switch (table) {
                    case "user" -> "select count(*) from social_account where provider_user_id = ?";
                    case "user_consent" ->
                            "select count(*) from user_consent c join social_account s on s.user_id = c.user_id"
                                    + " where s.provider_user_id = ?";
                    default -> throw new IllegalArgumentException(table);
                };
        Integer result = jdbcTemplate.queryForObject(sql, Integer.class, providerUserId);
        return result == null ? 0 : result;
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String refreshCookie(MvcResult result) {
        String header = result.getResponse().getHeader(HttpHeaders.SET_COOKIE);
        assertThat(header)
                .contains("HttpOnly")
                .contains("SameSite=Strict")
                .contains("Path=/api/v1/auth");
        return header.substring("refresh_token=".length(), header.indexOf(';'));
    }
}
