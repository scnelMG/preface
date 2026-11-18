# 프레임 추출 워커 계약 (INT-EXT-01~03)

Spring(BE)과 EC2 프레임 추출 워커가 주고받는 형식이다(S15P31B204-353). 추출 워커는 원본 얼굴 영상에서 3D 복원에 쓸 프레임을 골라
**묶음 파일 1개**로 만들고, GPU 워커(Runpod)는 영상 대신 이 묶음을 받는다(`contracts/reconstruction` INT-REC-01).

| 파일 | 내용 |
| --- | --- |
| `openapi.yaml` | INT-EXT-01 작업 가져가기(claim), 02 묶음 업로드 URL, 03 결과 보고 (OpenAPI 3.1) |
| `schemas/*.schema.json` | 요청·응답 본문과 렌즈 정보(`lens.schema.json`, INT-REC-01도 참조) |
| `fixtures/*.json` | 합성 예시(실제 얼굴·회원 데이터·서명 URL 아님). 이름이 같은 스키마로 검증된다(`result-*` → `result-request`) |

## 왜 이렇게 나눴나

- **원본 영상이 해외(Runpod)로 나가지 않는다.** 영상은 EC2에서 프레임을 뽑은 직후 지운다(S3 삭제 예약 + DB 주소 NULL).
- **프레임 선택은 영상이 있어야 한다.** 선명도·얼굴 검사로 고르고(그래서 장 수가 고정이 아니다), 렌즈 정보는 영상 메타에만 있다. 그래서 둘 다 EC2에서 한다.
- **묶음 1개 + SHA-256.** 프레임 URL 100개보다 내려받기·검증·만료(10분) 관리가 단순하다.

## 흐름

```text
FE 업로드 완료 → Spring: reconstruction_job(QUEUED, frames_ready_at NULL) = 추출 대기

추출 워커 루프 (동시 1건):
  POST /internal/v1/frame-extraction-jobs/claim {workerId}
    204 → 3~5초(지터) 쉬고 다시. 워커 설정 EXTRACT_IDLE_SEC로 늘릴 수 있다(운영 EC2는 15초: SSAFY 추출 워커 먼저, S15P31B204-594)
    200 → input.downloadUrl로 영상을 받고 checksumSha256 확인
        → frames_bundle.py extract (아래 "추출 명령") → 묶음 tar + 결과 JSON
        → 품질 실패(exit 2)면 POST .../result {status: FAILED, failCodes}
        → 성공이면 POST .../bundle-url {attempt, sizeBytes, checksumSha256} → 받은 PUT URL로 업로드(headers 그대로)
        → POST .../result {status: SUCCEEDED, bundle, lens, videoMeta}
        → 로컬 임시 파일(영상·묶음) 삭제

Spring (result SUCCEEDED, 한 트랜잭션):
  묶음 S3 확인(크기·체크섬) → 원본 영상 삭제 예약 + object_key NULL → 묶음 key·렌즈 저장 → frames_ready_at
  커밋 뒤 Redis recon:jobs LPUSH → GPU 워커가 INT-REC-01로 가져간다
```

- 추출 중과 추출 뒤 GPU 대기 동안 상태는 `QUEUED` 그대로지만, Spring이 진행 단계를 남겨 사용자 화면(API-REC-02·03 `stage`·`stageIndex`)에 드러낸다(S15P31B204-375).
  - claim(INT-EXT-01): `FRAME_SELECT`(1). lease가 끝나 다른 워커가 다시 가져가도 같다.
  - result SUCCEEDED(`frames_ready_at`): `QUALITY_CHECK`(2). GPU 워커가 꺼져 있어도 "추출 끝, 3D 대기"로 보인다.
  - result FAILED·lease 초과 실패: 실패한 단계(`FRAME_SELECT`)가 남는다.
  - GPU lease 회수로 대기열로 돌아가면 프레임이 남아 있으므로 `QUALITY_CHECK`로 되돌린다.
  - 차례를 기다리는 동안(추출 대기: 아무도 안 가져갔거나 추출 lease가 끝남, GPU 대기: 프레임 준비됨)은 상태 API가 `waiting: true`·`waitingSince`와 그 대기열 안 `queuePosition`을 준다. 추출 중(lease가 살아 있음)은 `waiting: false`다(S15P31B204-729, API 명세서 API-REC-02). 워커 계약은 바뀌지 않는다.
- 추출 워커는 단계를 보고하지 않는다(진행 API 없음). GPU 워커도 `FRAME_SELECT`는 보고하지 않는다.
- 인증: 모든 요청에 `X-Internal-Secret`(GPU 워커와 같은 값). 02·03에는 claim 때와 같은 `X-Worker-Id`.
- 추출 워커는 EC2 docker 내부망으로 api에 붙는다. DB·S3 자격 증명을 갖지 않고 presigned URL만 쓴다.

## 추출 대기열·lease·시도

- 대기열은 Redis가 아니라 DB 행이다: `status = QUEUED and frames_ready_at is null`. claim은 먼저 들어온 행을 `FOR UPDATE SKIP LOCKED`로 잡는다.
- claim 뒤 `leaseTimeoutSec`(가정 600초) 안에 result가 없으면 다른 워커가 같은 작업을 다시 가져간다(`attempt` +1).
- 시도가 `extract-max-attempts`(가정 2)를 넘은 작업은 다음 claim 때 `FAILED(TIMEOUT)`가 되고 사용자에게 실패 알림이 간다.
- 추출 워커가 하나도 묻지 않으면 claim이 오지 않으므로, job-manager가 1분마다 따로 끝낸다(S15P31B204-593). 지금 lease를 잡은 워커가 없는 작업 중 ① 시도를 다 쓴 작업은 바로, ② 접수 또는 마지막 claim 뒤 `extract-queue-timeout`(가정 20분) 동안 아무도 가져가지 않은 작업은 `FAILED(TIMEOUT)`로 끝낸다. 원본 보관 24시간·시도별 묶음 삭제 예약·실패 알림은 claim 때와 같다. 워커 쪽 동작은 바뀌지 않는다.
- result `FAILED`의 `failCodes`가 `INTERNAL` 하나뿐이고 시도가 `extract-max-attempts`보다 적으면 최종 실패로 끝내지 않는다. lease를 바로 풀어 다음 claim이 다음 시도(`attempt` +1)로 다시 추출하고, 이 시도가 올렸을 수 있는 묶음은 삭제를 예약한다. 원본 영상은 남는다. 다운로드 끊김·S3 업로드 503·추출 프로세스 OOM 같은 일시적인 오류용이다(S15P31B204-594, GPU 단계 INT-REC-03과 같은 규칙). 품질 실패(`QUALITY_*`)·`TIMEOUT`·여러 코드는 그대로 실패다. 응답은 똑같이 200 `accepted=true`라 워커 쪽 동작은 바뀌지 않는다.
- 묶음 key에 시도 번호가 들어간다(`.../frames-a{attempt}.tar`). 늦게 온 이전 시도의 업로드가 새 시도의 묶음을 덮지 않는다.
- claim 응답의 `capture`(선택, S15P31B204-617): `method`(`WEB_RECORDER`·`FILE`)·`deviceModel`. 웹 녹화 영상은 기기·렌즈 기록이 없어 워커가 `deviceModel`을 `frames_bundle.py extract --device-model`로 넘겨 렌즈 표 프로필을 출발값으로 쓴다. 영상 안 기록이 이기고, 없으면 필드가 없다. 설계: [웹 실시간 촬영 가이드](../../docs/design/live-capture-guide.md)
- `capture.trace`(선택, S15P31B204-640): 웹 녹화 촬영 기록(가이드 `meta`·단계 구간 `steps`·머리 각도 `trace` `[tMs, yaw, pitch, found]`·`trackSettings`). 웹 녹화 업로드 요청의 `captureTrace`를 서버가 해석하지 않고 그대로 넘긴다. 서버 검사는 trace 2,000점·steps 30개 상한과 시각 증가 순서뿐이고, 어긋나면 업로드는 받고 기록만 버린다. 원본 영상을 지우면 함께 지운다. 워커는 회전 부족 판정(QUALITY_ANGLE)·구간 자르기·각도 기준 선택에 쓴다(실패 원인 개선 계획 S1-1·S1-6·S1-2). 모양은 `schemas/claim-response.schema.json`이 원본이다. 워커는 값을 다시 검사하고(각도 숫자·범위, found 0·1), 프레임 각도 범위와 맞지 않으면 기록만 남기고 버린다(S15P31B204-662)
  - 각도의 한계(MediaPipe, 웹·서버 같음): 원본 시험 7건 575프레임을 SfM 각도와 비교하면(11/08) 15~60°는 모두 잡히고 오차 중앙값 3~5°(실제보다 3~5° 작게 읽음), 60~75°는 57%만 잡히고, 75° 넘으면 거의 놓치거나(8%) 40° 안팎 작게 읽는다. 그래서 35° 판정에는 쓰지만, 75~90° 측면을 찍었는지·측면 장수 판단에는 쓰지 않는다(SfM 각도·`found 0` 구간을 쓴다)
  - 프레임 고르기(S15P31B204-667, 스위치 `EXTRACT_TRACE_CUT`, 기본 꺼짐): 켜면 `steps`로 웹 가이드의 중복 구간을 빼고 같은 장수를 나머지 시간에 고르게 나눈다. 빼는 구간은 ① 고개 아래 멈춤 뒤 정면으로 돌아온 때부터 녹화 끝까지(마지막 정면·24초 대기) ② 왼쪽 끝 멈춤 뒤 45° 안쪽으로 들어온 때부터 정면 확인까지(쓸기에서 이미 지난 각도). 가이드는 앞 단계의 멈춤을 다음 단계 구간 앞에 기록하므로 단계 시작이 아니라 trace 각도로 경계를 찾는다. 모르는 `guideVersion`·단계 순서, trace와 영상 길이 차이 1.5초 초과, 남는 정면 1.5초·길이 10초 미만이면 자르지 않는다. 결과는 묶음 `manifest.json`의 `frames.traceCut`
  - 프레임 고르기, 새 머리 각도(S15P31B204-732, 스위치 `EXTRACT_POSE_SLOTS`, 기본 켬, `0`이면 시간 균등): 위 구간 자르기 대신 `trace`의 얼굴 각도로 고른다. 2.5°×2.5° 각도 칸에 처음 들어갈 때만 진행이 늘고, 진행을 프레임 장수만큼 고르게 나눈다(멈춤·대기·같은 각도 반복은 프레임을 받지 않음). 위아래는 그 녹화의 정면 각도 ±30°까지. 얼굴을 놓친 옆모습(35° 넘게 돌린 뒤 0.3초 이상)은 각도가 없어 시간 균등과 같은 몫(그 시간 ÷ 전체 시간)을 받는다. 가이드 버전·단계와 상관없다. trace가 없거나 깨졌거나 영상 길이와 1.5초 넘게 다르거나 채운 칸이 절반 미만이면 시간 균등. 결과는 묶음 `manifest.json`의 `frames.poseSlots`(applied·reason·cells·slots_filled)
    - 평상 높이(S15P31B204-735, 스위치 `EXTRACT_POSE_LEVEL`, 기본 켬): 정면 높이 ±10° 안은 위아래를 보지 않고 좌우 칸만 센다. 왼쪽 끝에서 돌아오는 길이 높이만 2~5° 달라 같은 좌우 각도를 새 칸으로 세던 것(11/09 191칸 중 142칸)을 막는다. ±10°를 넘는 고개 위·아래는 위의 2.5° 칸 그대로라 고개 든 프레임(턱 밑을 보는 유일한 프레임) 몫은 그대로다
    - 자이로 좌우(S15P31B204-735, 스위치 `EXTRACT_POSE_GYRO`, 기본 켬): `capture.trace.gyro`가 있으면 좌우 진행을 얼굴 각도 대신 자이로로 센다. 얼굴을 놓친 옆모습도 각도로 나뉘고(시간 몫 대신), 멈춰 있으면 프레임을 받지 않는다. 같은 녹화에서 얼굴이 보이는 45° 안쪽 줄로 부호·0점만 맞추고(사람별 값 없음) 절대 각도는 쓰지 않는다. 얼굴 각도와 직선 관계(기울기 절댓값 0.5~2, 상관 0.8 이상)가 아니면 쓰지 않고 얼굴 각도 규칙 그대로다(!591 전 잘못된 축 값, 폰 대신 고개를 돌린 녹화). 11/10 실측 기울기 0.99~1.22, 상관 0.97~1.00(iPhone 16·17·17 Pro, Galaxy S24). `frames.poseSlots`에 `gyro`(used·missing·rejected·off)·`slope`·`corr`·`level_band`를 남긴다

| 상황 | bundle-url | result |
| --- | --- | --- |
| 이 워커·시도의 추출 대기 작업 | 200 | 200 `accepted=true` 처리 |
| 같은 워커·시도의 재전송(이미 반영됨) | 409 | 200 `accepted=true`(처음 결과 유지) |
| lease로 다른 시도에 넘어감 | 409 `REC_022` | 200 `accepted=false`, 그 시도의 묶음 삭제 예약 |
| 취소(탈퇴·동의 철회) | 409 `REC_020` | 200 `accepted=false`, 묶음 삭제 예약 |
| 이미 끝남(성공·실패) | 409 `REC_021` | 200 `accepted=false` |

`accepted=false`면 워커는 작업을 버리고 로컬 파일만 지운다(올린 묶음은 Spring이 지운다).

## 추출 명령 (AI 파트 제공)

추출 워커는 아래 명령 하나만 부른다. 프레임 선택·마스크·렌즈 판단·품질 판정·묶음 생성을 모두 한다.

```bash
python tools/frames_bundle.py extract <영상파일> <frames.tar> --job-id <jobId> [--capture-trace <capture.trace JSON 파일>]
# stdout JSON: {bundle, bytes, sha256, frames, focalPx, quality, failCode, angle}
# exit 0 정상 / 2 품질 실패(failCode) / 그 밖 = 내부 오류(FAILED INTERNAL)
```

- 실행 환경(CPU 전용, Linux): Python 3.12, numpy 2.5.4, opencv-contrib-python 5.0.0.93, mediapipe 0.10.14, pillow 13.0.0,
  pillow-heif 1.8.1, protobuf 4.25.9. 영상 디코더 버전에 따라 뽑히는 프레임이 달라지므로 버전을 고정한다.
- 위치: `services/gpu-worker/reconstruction/tools/frames_bundle.py`(S15P31B204-355). 추출 워커 이미지(`Dockerfile.extract`)가
  `reconstruction/requirements-extract.txt`와 얼굴 인식 모델(`tools/fetch_models.py`)을 빌드 때 넣고, 워커와 같은 Python으로 부른다.
- stdout 마지막 줄 JSON의 `frames`가 장 수다. 종료 코드 2여도 묶음 파일은 만들어지지만 워커는 올리지 않고 FAILED로 보고한다.

## 묶음 형식

압축 없는 tar(`application/x-tar`). JPEG·PNG라 압축 이득이 적다. 형식 이름은 `manifest.json`의 `format: "lm-frames/1"`.

```text
manifest.json   묶음 버전·jobId·장 수 등 목록
lens.json       렌즈 정보 (lens.schema.json과 같은 키)
prepare.json    프레임 목록·각도 등 선택 정보
images/*.jpg    프레임 (frameCount = images/ 장 수, 최대 100장)
masks/*.png     머리 마스크 (없을 수 있음)
```

- `lens.json`: `focalPx`(GPU 사용값, 숫자|null), `focalSource`(`file`|`same-model file`|`device profile`|`none`), `focal35mm`, `deviceMake`,
  `deviceModel`, `lensModel`, `deviceProfile`, `imageWidth`, `imageHeight`. 계약(result·INT-REC-01)에는 `focalPx`·`focalSource`가 필수다.
- 5방향 얼굴 사진(FRONT·LEFT·RIGHT·LEFT_45·RIGHT_45)은 GPU 워커가 묶음(`prepare.json` 각도)에서 골라 INT-REC-04 `captures`로 올린다.

## 품질 실패

| 코드 | 기준 | 처리 |
| --- | --- | --- |
| `QUALITY_NO_FACE` | 쓸 수 있는 프레임 20장 미만 | 추출 단계에서 FAILED. GPU까지 가지 않는다 |
| `QUALITY_ANGLE` | 얼굴이 잡힌 프레임 중 가장 많이 돌린 프레임이 좌우 어느 한쪽이라도 35° 미만, 또는 정면 15° 안의 프레임 없음 (GPU 5방향 사진 고르기와 같은 규칙·값) | 추출 단계에서 FAILED. GPU까지 가지 않는다(S15P31B204-662). 실패 보고 `debugMessage`에 좌우 최대 각도를 남기고, 웹 녹화면 `capture.trace`로 가른 원인(`turn` 덜 돌림 / `selection` 돌렸지만 고른 프레임에 없음)도 남긴다. trace는 원인 설명에만 쓰고, trace만으로 통과시키지는 않는다(GPU는 묶음 프레임만 쓴다) |

## 보관·삭제 (영상과 같은 정책)

| 대상 | 언제 지우나 |
| --- | --- |
| 원본 영상 | 추출 성공 즉시. 추출 실패·시간 초과면 종료 + 24h |
| 프레임 묶음 | 3D 성공 즉시. 3D 실패·취소면 종료 + 24h(job-manager). 탈퇴·얼굴 동의 철회는 즉시 |
| 받아들이지 않은 시도의 묶음 | result 거절 때 바로. `INTERNAL`로 다시 추출하게 된 시도의 묶음도 그 보고 때 바로 |
| 쓰지 않은 시도의 묶음 | 다른 시도의 성공 보고 때 바로(앞선 시도가 묶음을 올리고 보고 전에 끊긴 경우, S15P31B204-595) |
| 워커 디스크의 작업 폴더 | 작업이 끝나면 바로. 워커가 강제로 꺼져 남은 것은 워커가 시작할 때와 한 시간마다 2시간 지난 것을 지운다(S15P31B204-595) |

S3 삭제는 모두 `data_deletion_log`(target_type `FACE_UPLOAD_FRAMES`, 묶음 1개 = 1행)를 거쳐 job-manager가 한다.

## 값 규칙

- 묶음 key는 bundle-url이 준 `objectKey`를 그대로 쓴다. result의 `bundle.objectKey`가 다르면 400.
- `bundle.frameCount`는 1~`maxFrames`. 넘으면 400.
- `videoMeta`는 INT-REC-03과 같은 형식이고 위치(GPS)는 보내지 않는다. 이미지·서명 URL·토큰은 어느 필드에도 넣지 않는다.
- 서명 URL과 시크릿은 워커 로그에도 남기지 않는다.

## 바꿀 때

`contracts/reconstruction/README.md` "바꿀 때"와 같다. 스키마를 바꾸면 fixture와 Spring 구현(`FrameExtractionService`)을 같은 MR에서 고친다.
