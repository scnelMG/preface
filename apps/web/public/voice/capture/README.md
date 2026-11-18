# 촬영 안내 음성

웹 실시간 촬영 가이드(`src/features/live-capture`, S15P31B204-619)가 재생하는 음성이다.

- **파일 이름이 키다.** 같은 이름의 `.m4a`로 바꿔 넣으면 코드를 고치지 않고 음성이 바뀐다.
- 쓰는 키 목록은 `src/features/live-capture/voicePlayer.ts`의 `VOICE_KEYS`다. 테스트가 이 폴더에 모두 있는지 확인한다.
- 지금 파일은 Azure TTS `ko-KR-SunHiNeural`(기본 속도)로 만들었다(S15P31B204-692, 2026-11-09). 긴 문장 8개는 짧게 다시 만들었다(-776, 2026-11-11). `recleft`·`checkdone`은 -777에서 다시 고쳤다. 그 전에는 Windows TTS(Microsoft Heami Desktop)였다.
- 형식: AAC 22.05kHz 모노 48kbps. 앞뒤 무음은 잘라 낸다(단계 전환이 음성 끝을 기다리므로 무음이 남으면 그만큼 늦어진다).
- 파일은 미리 만들어 둔다. 사용자가 촬영할 때 TTS를 부르지 않으므로 사용자 수와 비용이 무관하다.

## 다시 만들기

1. Azure Speech 리소스(무료 F0)의 KEY 1과 지역을 **로컬 사용자 환경 변수**로만 둔다(`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`). 키를 저장소·서버·채팅에 넣지 않는다.
2. 아래 문장을 SSML `<voice name='ko-KR-SunHiNeural'>`로 REST(`https://<지역>.tts.speech.microsoft.com/cognitiveservices/v1`, 출력 `riff-24khz-16bit-mono-pcm`)에 보내 wav를 받는다.
3. `ffmpeg -i <키>.wav -af "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse" -c:a aac -ar 22050 -ac 1 -b:a 48k <키>.m4a`
4. 문장을 바꾸면 이 표도 같이 고친다.

## 문장

| 구분         | 키           | 문장                                                                     |
| ------------ | ------------ | ------------------------------------------------------------------------ |
| 검사         | `soundcheck` | 잘 들리면 '잘 들려요'를 눌러요.                                          |
| 검사         | `v4ready`    | 얼굴을 테두리에 맞춰요.                                                  |
| 검사         | `noface`     | 얼굴이 안 보여요.                                                        |
| 검사         | `v4farther`  | 더 멀리.                                                                 |
| 검사         | `closer`     | 더 가까이.                                                               |
| 검사         | `raise`      | 눈높이로 올려요.                                                         |
| 검사         | `lower`      | 조금 내려요.                                                             |
| 검사         | `lookfront`  | 정면을 봐요.                                                             |
| 검사         | `bangs`      | 앞머리를 머리띠로 올려 주세요.                                           |
| 검사         | `glasses`    | 안경을 벗어 주세요.                                                      |
| 검사         | `checkdone`  | 검사 완료.                                                               |
| 검사         | `toright`    | 촬영 중에는 고개를 움직이지 않습니다. 오른손으로 휴대폰을 오른쪽 끝까지. |
| 단계 안내    | `goright`    | 오른쪽 끝까지.                                                           |
| 단계 안내    | `recleft`    | 촬영을 시작합니다. 다시 정면으로 천천히.                                 |
| 단계 안내    | `switchhand` | 왼손으로 바꿔 잡아요.                                                    |
| 단계 안내    | `sweepleft`  | 왼쪽 끝까지 천천히.                                                      |
| 단계 안내    | `backfront`  | 정면으로 돌아와요.                                                       |
| 단계 안내    | `headup`     | 고개를 들어요.                                                           |
| 단계 안내    | `headdown`   | 고개를 숙여요.                                                           |
| 단계 안내    | `holdside`   | 그대로.                                                                  |
| 단계 안내    | `more`       | 조금 더.                                                                 |
| 단계 안내    | `finishwait` | 정면에서 잠깐만요.                                                       |
| 단계 안내    | `done`       | 촬영이 끝났어요.                                                         |
| 녹화 중 경고 | `wfar`       | 더 멀리.                                                                 |
| 녹화 중 경고 | `wnear`      | 더 가까이.                                                               |
| 녹화 중 경고 | `wheight`    | 눈높이로.                                                                |
| 녹화 중 경고 | `wupright`   | 똑바로.                                                                  |
| 녹화 중 경고 | `wsteady`    | 흔들지 마세요.                                                           |
| 녹화 중 경고 | `wslow`      | 천천히.                                                                  |
| 녹화 중 경고 | `weyes`      | 눈 뜨세요.                                                               |
| 녹화 중 경고 | `wheadfix`   | 고개는 그대로.                                                           |
