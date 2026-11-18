package com.preface.api.consult.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ConsultCommandTest {

    @Test
    void 되돌리기_앞으로가기_초기화_문장을_명령으로_알아본다() {
        assertThat(ConsultCommand.parse("방금 거 취소해줘")).contains(ConsultCommand.UNDO);
        assertThat(ConsultCommand.parse("되돌리기")).contains(ConsultCommand.UNDO);
        assertThat(ConsultCommand.parse("다시 해줘")).contains(ConsultCommand.REDO);
        assertThat(ConsultCommand.parse("처음 상태로 돌려줘")).contains(ConsultCommand.RESET);
        assertThat(ConsultCommand.parse(" 편집 초기화 ")).contains(ConsultCommand.RESET);
    }

    @Test
    void 더와_덜은_직전_거래_조절_명령이다() {
        assertThat(ConsultCommand.parse("조금 더")).contains(ConsultCommand.MORE);
        assertThat(ConsultCommand.parse("더 해줘")).contains(ConsultCommand.MORE);
        assertThat(ConsultCommand.parse("덜")).contains(ConsultCommand.LESS);
        assertThat(ConsultCommand.parse("아까보다 조금만 덜 해줘")).contains(ConsultCommand.LESS);
        assertThat(ConsultCommand.parse("방금 한 걸 조금 약하게 해줘")).contains(ConsultCommand.LESS);
        assertThat(ConsultCommand.parse("방금 거 좀 강하게 해줘")).contains(ConsultCommand.MORE);
        assertThat(ConsultCommand.parse("조금 더 좁혀줘")).contains(ConsultCommand.NARROW);
        assertThat(ConsultCommand.parse("더 줄여줘")).contains(ConsultCommand.REDUCE);
        assertThat(ConsultCommand.parse("둘 다")).contains(ConsultCommand.BOTH);
        assertThat(ConsultCommand.parse("더 줄여주지 마")).isEmpty();
        assertThat(ConsultCommand.parse("더 넓혀줘")).contains(ConsultCommand.WIDEN);
    }

    @Test
    void 이어_말한_조절은_접속어와_말끝이_달라도_같은_명령이다() {
        assertThat(ConsultCommand.parse("그럼 더 줄여주세요")).contains(ConsultCommand.REDUCE);
        assertThat(ConsultCommand.parse("그럼 한 단계만 더 줄여줘")).contains(ConsultCommand.REDUCE);
        assertThat(ConsultCommand.parse("한 칸 더 줄여주세요")).contains(ConsultCommand.REDUCE);
        assertThat(ConsultCommand.parse("한 단계 더 줄이지 마세요")).isEmpty();
        assertThat(ConsultCommand.parse("그러면, 살짝만 더 줄여 주실래요")).contains(ConsultCommand.REDUCE);
        assertThat(ConsultCommand.parse("그렇다면 더 넓혀주세요")).contains(ConsultCommand.WIDEN);
        assertThat(ConsultCommand.parse("그럼 두 개 다요")).contains(ConsultCommand.BOTH);
        assertThat(ConsultCommand.parse("그럼 더 줄여주지 마세요")).isEmpty();
        assertThat(ConsultCommand.parse("그러면 콧대를 더 줄여주세요")).isEmpty();
    }

    @Test
    void 부위를_지목한_문장은_명령이_아니라_AI_상담으로_간다() {
        assertThat(ConsultCommand.parse("콧대를 더 높여줘")).isEmpty();
        assertThat(ConsultCommand.parse("눈꼬리 취소해줘")).isEmpty();
        assertThat(ConsultCommand.parse("콧대를 조금 높여줘")).isEmpty();
        assertThat(ConsultCommand.parse("콧대를 강하게 높여줘")).isEmpty();
    }
}
