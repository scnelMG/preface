package com.preface.api.consult.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.preface.api.consult.dto.ApplyResult;
import com.preface.api.consult.dto.EditAction;
import com.preface.api.consult.dto.SendMessageRequest.ModeSwitch;
import com.preface.api.consult.dto.SkippedClause;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** {@code change_request.request_json}·{@code consult_message.options}(MySQL JSON 컬럼) ↔ 객체 변환. */
@Component
@RequiredArgsConstructor
public class ConsultJson {

    private static final TypeReference<List<StoredOption>> OPTIONS = new TypeReference<>() {};

    private final JsonMapper jsonMapper;

    /**
     * 변경 요청 전체. 상태는 컬럼({@code status})이 원본이라 JSON에 두지 않는다.
     *
     * @param applyResult API-EDIT-05 성공 후에만 채운다(CON-02 복원용)
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record StoredRequest(
            String requestId,
            String schemaVersion,
            List<EditAction> actions,
            List<SkippedClause> skipped,
            String sourceText,
            ApplyResult applyResult,
            ModeSwitch modeSwitch,
            ConsultCorrection.Selection correction,
            Integer guidanceStateVersion) {
        StoredRequest withApplyResult(ApplyResult result) {
            return new StoredRequest(
                    requestId,
                    schemaVersion,
                    actions,
                    skipped,
                    sourceText,
                    result,
                    modeSwitch,
                    correction,
                    guidanceStateVersion);
        }
    }

    /**
     * 되묻기 선택지. 응답에는 {@code id}·{@code label}만 내보내고, 후보 효과와 묶인 {@code stateVersion}은 서버에만 둔다(시안이 바뀐
     * 뒤 누른 옛 선택지는 적용하지 않는다).
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record StoredOption(
            String id,
            String label,
            List<EditAction> actions,
            int stateVersion,
            ConsultCorrection.Selection correction,
            String guideCode) {}

    public String write(Object value) {
        return jsonMapper.writeValueAsString(value);
    }

    public StoredRequest readRequest(String json) {
        return jsonMapper.readValue(json, StoredRequest.class);
    }

    public List<StoredOption> readOptions(String json) {
        return json == null ? List.of() : jsonMapper.readValue(json, OPTIONS);
    }
}
