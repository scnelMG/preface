package com.preface.api.notification.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class MattermostWebhookClientTest {

    @Test
    void 모든_DM은_Preface_머리줄로_시작하고_맨_아래에_자동_알림임을_밝힌다() {
        var body = MattermostWebhookClient.payload("tester", "#### ✅ 새 모델이 완성됐어요");

        assertThat(body.get("channel")).isEqualTo("@tester");
        assertThat(body.get("text"))
                .isEqualTo(
                        ":preface: **Preface 알림**\n"
                                + "#### ✅ 새 모델이 완성됐어요\n\n"
                                + "---\n"
                                + "이 메시지는 Preface가 자동으로 보냈어요 · 답장은 확인하지 않아요");
    }
}
