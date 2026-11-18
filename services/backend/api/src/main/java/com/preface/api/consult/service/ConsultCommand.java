package com.preface.api.consult.service;

import java.util.Optional;
import java.util.regex.Pattern;

/** 저장된 시안 상태가 있어야 처리할 수 있는 짧은 명령. GMS 호출 전에 Spring이 직접 처리한다. */
public enum ConsultCommand {
    UNDO,
    REDO,
    RESET,
    MORE,
    LESS,
    NARROW,
    WIDEN,
    REDUCE,
    BOTH;

    private static final Pattern MORE_OR_LESS =
            Pattern.compile(
                    "(?:조금\\s*)?(?:더|덜)(?:\\s*(?:많이|조금|해줘|해주세요))?[.!?\\s]*"
                            + "|(?:아까보다\\s*)?조금만\\s*덜\\s*해줘[.!?\\s]*");
    private static final Pattern RECENT_INTENSITY =
            Pattern.compile(
                    "(?:방금\\s*(?:한\\s*)?(?:걸|것|거)(?:을)?\\s*)?(?:조금|좀|약간)?\\s*(?:약하게|강하게)(?:\\s*해줘|해주세요)?[.!?\\s]*");
    private static final Pattern WIDTH_FOLLOW_UP =
            Pattern.compile("(?:조금\\s*)?더\\s*(?:좁혀|넓혀)(?:\\s*줘|주세요)?[.!?\\s]*");
    private static final Pattern FOLLOW_UP_PREFIX =
            Pattern.compile("^(?:그러면|그럼|그렇다면|그렇게 하고)(?:\\s|[,，])+");
    private static final Pattern UNDO_TEXT =
            Pattern.compile("(?:방금\\s*거\\s*)?(?:취소해줘|되돌려줘|되돌리기)[.!?\\s]*");
    private static final Pattern REDO_TEXT = Pattern.compile("(?:다시\\s*해줘|다시\\s*실행)[.!?\\s]*");
    private static final Pattern RESET_TEXT =
            Pattern.compile("(?:처음으로|처음\\s*상태로\\s*돌려줘|편집\\s*초기화)[.!?\\s]*");

    /** 앞뒤 공백을 지운 문장 전체가 명령과 맞을 때만. */
    public static Optional<ConsultCommand> parse(String content) {
        String text = content == null ? "" : content.strip();
        if (UNDO_TEXT.matcher(text).matches()) {
            return Optional.of(UNDO);
        }
        if (REDO_TEXT.matcher(text).matches()) {
            return Optional.of(REDO);
        }
        if (RESET_TEXT.matcher(text).matches()) {
            return Optional.of(RESET);
        }
        text = FOLLOW_UP_PREFIX.matcher(text).replaceFirst("");
        if (text.matches(
                "(?:(?:조금만?|살짝만?|좀|약간|한\\s*(?:단계|칸)(?:만)?)\\s*)?더\\s*줄여\\s*(?:줘|주세요|주실래요)?[.!\\s]*")) {
            return Optional.of(REDUCE);
        }
        if (text.matches("(?:둘|두\\s*개)\\s*다(?:요)?[.!\\s]*")) {
            return Optional.of(BOTH);
        }
        if (MORE_OR_LESS.matcher(text).matches()) {
            return Optional.of(text.contains("덜") ? LESS : MORE);
        }
        if (RECENT_INTENSITY.matcher(text).matches()) {
            return Optional.of(text.contains("약하게") ? LESS : MORE);
        }
        if (WIDTH_FOLLOW_UP.matcher(text).matches()) {
            return Optional.of(text.contains("좁혀") ? NARROW : WIDEN);
        }
        return Optional.empty();
    }
}
