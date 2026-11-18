# README 시각 자료 출처

팀이 제공한 발표자료의 이미지·애니메이션을 공개 README에 맞게 추출했다. 원본 발표덱과 실제 얼굴 자료는 저장소에 올리지 않는다.

## 원본

- `Preface-발표덱-팀공유-1117최신 (1).zip` — 최종 발표덱과 수록 미디어
- `Preface-동시접속-워커4장.zip` — Redis 대기열·GPU 워커 보충 설명

발표자료의 가상 인물 상황 예시·촬영 안내·얼굴 없는 상담 UI·설명 도식만 사용했다. 실제 인물 사진, 촬영 화면의 얼굴, 개인 얼굴로 만든 3D, 팀원 개인 모델은 제외했다. 가상 인물 이미지를 실제 유저 테스트 사진으로 해석하지 않는다.

## 파일별 내역

| 공개 파일 | 발표자료의 원본 | 처리 |
| --- | --- | --- |
| `ai-consult.gif` | `assets/video/ppt_ai_card.gif` | 얼굴 없는 상담 카드 애니메이션을 그대로 복사했다 |
| `capture-guide.gif` | `assets/video/ppt_capture_pose.webp` | 촬영 안내 일러스트를 GIF로 변환했다. 원본 재생 시간을 유지하고 프레임 수·너비를 줄였다. 투명 여백은 밝은 배경으로 합성했다 |
| `painpoint-simulation.gif` | `assets/img/painpoints-v2/pp1-quality-v2.gif` | 원본 GIF를 그대로 복사했다. 발표덱에 가상 인물 상황 예시로 명시되어 있다 |
| `painpoint-visit.gif` | `assets/img/painpoints-v2/pp2-quality-v2.gif` | 원본 GIF를 그대로 복사했다. 발표덱에 가상 인물 상황 예시로 명시되어 있다 |
| `painpoint-consult.gif` | `assets/img/painpoints-v2/pp3-quality-v2.gif` | 원본 GIF를 그대로 복사했다. 발표덱에 가상 인물 상황 예시로 명시되어 있다 |
| `workers.gif` | 보충 발표 2·3장 | 워커 1개·4개의 원본 애니메이션을 차례로 렌더링해 반복 GIF로 만들었다 |
| `cpu-parallel.gif` | 최종 발표 32·33장 | 순차·병렬 CPU 계산의 원본 애니메이션을 차례로 렌더링했다 |
| `texture-gpu.gif` | 최종 발표 29·30장 | CPU·GPU 텍스처 처리의 원본 애니메이션을 차례로 렌더링했다 |
| `architecture.png` | 최종 발표 41장 | 원본 시스템 아키텍처를 PNG로 렌더링했다 |
| `generation-failure.png` | 최종 발표 27장 | 생성 실패율 결과 화면을 PNG로 렌더링했다 |
| `modeling-time.png` | 최종 발표 36장 | 생성 시간 결과 화면을 PNG로 렌더링했다 |
| `user-similarity.png` | 최종 발표 38장 | 얼굴 유사도 사용자 평가 화면을 PNG로 렌더링했다 |
| `skin-feedback.png` | 최종 발표 39장 | 피부 표현 사용자 평가 화면을 PNG로 렌더링했다 |

렌더링은 발표덱의 HTML·CSS·JavaScript와 글꼴을 사용했다. 발표 조작용 페이지 번호는 숨겼다. 설명 도식의 구성·문구·숫자를 새로 만들거나 바꾸지 않았다. GIF는 해상도와 색상 수를 줄여 용량을 조정했다.

## 해석 기준

상담 GIF는 발표 시점의 UI 기록이며, 정량적인 추천 정확도 평가 자료는 아니다. 워커·CPU·GPU GIF는 **처리 구조를 설명하는 개념 애니메이션**이다. 그림의 대기 인원·진행률·코어 상태를 실제 운영 로그나 부하 테스트 측정값으로 해석하지 않는다.

결과 PNG는 팀의 발표 수치다. 측정 조건과 한계는 [README의 팀 성과](../../../README.md#팀-성과)에 함께 기재했다. 이미지·기술 성과를 개인이 단독으로 만든 것으로 표기하지 않는다.

## 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-11-18 | 공개 가능한 발표 미디어 13종의 출처·변환·해석 기준을 기록했다 |
