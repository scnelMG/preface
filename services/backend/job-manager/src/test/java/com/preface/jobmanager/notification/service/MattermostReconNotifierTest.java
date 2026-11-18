package com.preface.jobmanager.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.preface.common.reconstruction.entity.ReconstructionJob;
import com.preface.common.reconstruction.repository.ReconstructionJobRepository;
import com.preface.common.user.entity.User;
import com.preface.common.user.repository.UserRepository;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.ResourceAccessException;

/**
 * job-manager 실패 DM(S15P31B204-530). 문안은 api MattermostNotifier와 같아야 한다. HTTP는 보내지 않는다(post를 가로챈다).
 */
class MattermostReconNotifierTest {

    private static final String JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40";
    private static final String USER = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    private static final String HOOK = "https://mm.example.test/hooks/synthetic";

    private final ReconstructionJobRepository jobRepository =
            mock(ReconstructionJobRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);

    @Test
    void 아이디를_등록한_사용자에게_자동_알림_표시와_실패_문구_링크를_보낸다() {
        MattermostReconNotifier notifier = notifier(HOOK, "https://preface.example.test/");
        user("hong", true);

        notifier.reconFailed(JOB);

        verify(notifier)
                .post(
                        Map.of(
                                "channel",
                                "@hong",
                                "text",
                                ":preface: **Preface 알림**\n"
                                        + "#### ⚠️ 3D를 만들지 못했어요\n이유와 고치는 방법을 확인해 주세요.\n\n"
                                        + "**[→ 이유 보기](https://preface.example.test/reconstructions/"
                                        + JOB
                                        + ")**\n\n---\n"
                                        + "이 메시지는 Preface가 자동으로 보냈어요 · 답장은 확인하지 않아요",
                                "username",
                                "Preface 알림"));
    }

    @Test
    void webhook이_비어_있으면_DB도_보지_않는다() {
        MattermostReconNotifier notifier = notifier("", "");

        notifier.reconFailed(JOB);

        verifyNoInteractions(jobRepository, userRepository);
        verify(notifier, never()).post(any());
    }

    @Test
    void 아이디를_등록하지_않았거나_탈퇴한_사용자에게는_보내지_않는다() {
        MattermostReconNotifier notifier = notifier(HOOK, "");
        user(null, true);
        notifier.reconFailed(JOB);

        user("hong", false);
        notifier.reconFailed(JOB);

        verify(notifier, never()).post(any());
    }

    @Test
    void 보내기가_실패해도_예외를_밖으로_던지지_않는다() {
        MattermostReconNotifier notifier = notifier(HOOK, "");
        user("hong", true);
        doThrow(new ResourceAccessException("timeout")).when(notifier).post(any());

        assertThatCode(() -> notifier.reconFailed(JOB)).doesNotThrowAnyException();
    }

    @Test
    void FE_주소가_없으면_링크_없이_보낸다() {
        assertThat(notifier(HOOK, "").message(JOB))
                .isEqualTo("#### ⚠️ 3D를 만들지 못했어요\n이유와 고치는 방법을 확인해 주세요.");
    }

    private MattermostReconNotifier notifier(String webhookUrl, String webBaseUrl) {
        MattermostReconNotifier notifier =
                spy(
                        new MattermostReconNotifier(
                                jobRepository,
                                userRepository,
                                new MattermostProperties(webhookUrl, webBaseUrl, null)));
        doNothing().when(notifier).post(any());
        return notifier;
    }

    private void user(String mattermostUsername, boolean active) {
        ReconstructionJob job = mock(ReconstructionJob.class);
        when(job.getUserId()).thenReturn(USER);
        when(jobRepository.findById(JOB)).thenReturn(Optional.of(job));
        User user = mock(User.class);
        when(user.isActive()).thenReturn(active);
        when(user.getMattermostUsername()).thenReturn(mattermostUsername);
        when(userRepository.findById(USER)).thenReturn(Optional.of(user));
    }
}
