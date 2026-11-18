package com.preface.api.consult.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.preface.api.consult.dto.EditAction;
import com.preface.api.consult.dto.SendMessageRequest.ModeSwitch;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class ConsultJsonTest {
    @Test
    void 이전_네_필드_후보도_읽고_눈_후보의_원문과_확인한_전환을_보존한다() {
        var codec = new ConsultJson(JsonMapper.builder().build());
        var old =
                codec.readRequest(
                        "{\"requestId\":\"r\",\"schemaVersion\":\"v2\",\"actions\":[{\"code\":\"nose.bridge_height\",\"side\":\"both\",\"direction\":1,\"strength\":\"small\"}],\"skipped\":[]}");
        assertThat(old.actions())
                .containsExactly(new EditAction("nose.bridge_height", "both", 1, "small"));
        assertThat(old.sourceText()).isNull();
        assertThat(old.modeSwitch()).isNull();
        assertThat(codec.write(old)).doesNotContain("\"source\":null", "\"sourceText\":null");

        var eye =
                new ConsultJson.StoredRequest(
                        "new",
                        "v2",
                        List.of(new EditAction("eye.inner", "both", 1, "small", "눈도 앞트임 해줘")),
                        List.of(),
                        "콧대를 높이고 눈도 앞트임 해줘",
                        null,
                        new ModeSwitch("toFace", 4),
                        null,
                        null);
        assertThat(codec.readRequest(codec.write(eye))).isEqualTo(eye);
    }

    @Test
    void 선택_정정은_대상과_후보를_만들_때의_시안_버전을_보존한다() {
        var codec = new ConsultJson(JsonMapper.builder().build());
        var control = ConsultCorrection.Control.TIP_PROJECTION;
        var selection = new ConsultCorrection.Selection(control, 12, false);
        var option =
                new ConsultJson.StoredOption(
                        "o", "코끝 앞뒤 변경 되돌리기", List.of(control.action()), 12, selection, null);
        var request =
                new ConsultJson.StoredRequest(
                        "r",
                        "v2",
                        option.actions(),
                        List.of(),
                        option.label(),
                        null,
                        null,
                        selection,
                        null);
        assertThat(codec.readOptions(codec.write(List.of(option)))).containsExactly(option);
        assertThat(codec.readRequest(codec.write(request))).isEqualTo(request);
    }
}
