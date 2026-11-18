# reconstruction (3D 복원 코드)

영상에서 3D 얼굴을 만드는 AI 파이프라인을 둔다. **EC2 프레임 추출 명령**(S15P31B204-355)과 **GPU 3D 복원**(S15P31B204-357)이 같은 코드를 쓴다.
GPU 워커 루프(묶음 받기 → 3D → 결과 업로드)는 [`app/reconstruction/worker.py`](../app/reconstruction/worker.py)에 있고 이 폴더의 `frames_bundle.py run`을 부른다.

- 계약: [`contracts/frame-extraction`](../../../contracts/frame-extraction/README.md) "추출 명령"·"묶음 형식", [`contracts/reconstruction`](../../../contracts/reconstruction/README.md) INT-REC-01~04
- 원본: live-mirror PoC 공유본(`live-mirror-poc-gpu-code-20261025-final.zip`, SHA-256 `a8ef0c94…`)의 파일을 고치지 않고 옮겼다. `run_all.py`에서 닿는 파일만 골랐다(`pipeline/`, `tools/`, `engine/`). 새로 만든 파일은 `tools/frames_bundle.py`·`tools/fetch_models.py`뿐이다.

| 경로 | 내용 |
| --- | --- |
| `tools/frames_bundle.py` | `extract`(EC2: 영상 → `frames.tar`), `run`(GPU: `frames.tar` → 3D. GPU 워커가 부른다) |
| `tools/fetch_models.py` | 모델 파일을 공식 주소에서 받고 SHA-256을 확인한다. 기본은 추출용 얼굴 인식 모델(3.7MB), `--all`은 GPU용 분할 모델(16MB)·GNM 머리 모델(53MB)까지. 모델 파일은 git에 넣지 않는다 |
| `pipeline/run_all.py` | 단계 실행기: prepare(프레임 선택) → sfm(COLMAP) → lens → model(형상·눈·텍스처) → viewer(GLB). `extract`는 `--until prepare`까지만 부른다 |
| `pipeline/prepare_capture.py`, `video_scan.py`, `face_flags.py` | 프레임 선택: 시간 균등 100칸 → 칸마다 가장 선명한 장면, 흐림·눈 감음 제외, 얼굴 각도, 마스크 |
| `pipeline/video_meta.py`, `assets/device_profiles.json` | 렌즈: 영상 메타(아이폰 35mm 환산 초점) → 없으면 기종 표(삼성 S24 등) |
| `pipeline/scan_to_model.py` 외 | 형상 맞춤(GNM), 눈 부위, 텍스처 굽기, 최종 검사. `tools/colmap/`, `tools/*glb*.py`, `tools/rig_blocks.py`(+ `engine/*.mjs`, Node.js) |
| `assets/gnm-template-v2.npz`, `gnm-detail-v1.npz` | PoC가 GNM(Apache-2.0, `assets/GNM-LICENSE.txt`)에서 만든 머리 틀(3MB). 공식 배포처가 없어 git에 둔다 |
| `tools/rig_expression.py`, `assets/gnm_semantic_classes.json` | 편집실 표정 트래킹용 리그(`model/expression.json`)를 최종 head.glb·rig.json으로 만든다(모델당 약 2초, 기존 모델 보충에도 쓴다). 자료 파일은 GNM 의미 표정 생성기(Apache-2.0)에 분류 3개(squint·blow·happy)를 넣은 대표 표정이다(19KB, 원 파일 sha256 기록) |

## 설치 (Linux, CPU 전용)

```bash
pip install -r requirements-extract.txt     # Python 3.12. 버전을 바꾸지 않는다(아래 "버전 고정")
python tools/fetch_models.py                # assets/face_landmarker.task (SHA-256 확인)
```

- slim 이미지에서는 OpenCV가 쓰는 `libgl1`·`libglib2.0-0`를 apt로 설치한다.
- Windows에서도 `PYTHONUTF8` 없이 추출·테스트가 된다(`run_all.py`의 기종 표·`run_all.json`·`prepare.json` 읽기를 UTF-8로 고정, S15P31B204-374).

## 추출 명령 (EC2)

```bash
python tools/frames_bundle.py extract <영상파일> <frames.tar> --job-id <jobId>
```

- 영상 파일 이름에 확장자가 없어도 된다(추출 워커는 `input`으로 받는다). 앞부분 바이트로 mov·mp4·webm(mkv로 읽음)을 가린다.
- stdout 마지막 줄 JSON: `{bundle, bytes, sha256, frames, frameCount, focalPx, focalSource, quality, failCode, extractSec}`. 추출 워커는 `frames`를 읽는다.
- exit `0` 묶음 생성(PASS·WARN), `2` 품질 실패(`failCode` = `QUALITY_NO_FACE`: 얼굴이 잡힌 프레임 20장 미만. 사진 선택 단계는 얼굴 없는 장면도 남기므로 추출 명령이 따로 센다(S15P31B204-374)), 그 밖 = 내부 오류.
- 옆모습 부족(좌우 35° 이상 프레임 없음)은 지금 경고(WARN)로 두고 진행한다. `QUALITY_ANGLE` 실패로 바꿀지는 형상 쪽에서 정한다.
- 작업 중 `work/_bundle-<jobId>/`를 쓰고 끝나면 지운다. 묶음에는 로컬 경로를 넣지 않는다.

### 렌즈 (`lens.json`)

| `focalSource` | 언제 | 비고 |
| --- | --- | --- |
| `file` | 아이폰 원본(35mm 환산 초점이 기록됨), Android 15 이상으로 출시된 갤럭시 원본(`udta/smta/lens`, S15P31B204-467) | 아이폰은 영상 프레임 기준 값이라 정확하다. 갤럭시 렌즈 기록(Z Flip7: 22, 23, 23)은 사진(4:3) 기준 35mm 환산으로 읽고 가장 많이 나온 값(23)을 기종 프로필과 같은 식(영상 보정 1.09)으로 바꾼다. 어느 값이 영상용인지 확인 전이라 `focalEstimate: true`(추정값과 같은 재시도)로 넘기고 원래 값은 `samsungLens`에 남긴다 |
| `device profile` | 기종만 기록된 영상(삼성 등)이 기종 표에 있을 때 | 갤럭시 S20~S26(S20 FE 제외), A14~A73 주요 기종(GSMArena·위키백과 35mm 환산), Z Flip4~6 안쪽 카메라·Z Fold4~6 커버 카메라(삼성 공식 화각)(S15P31B204-468). 갤럭시는 모델 코드 앞 7자리로 찾는다, 아이폰 12~18 Pro(Duo 제외, 영상에 적힌 모델명으로 찾음, 사진 앱에서 자른 영상은 모델명만 남고 렌즈 기록이 빠져서 이 표를 쓴다). 갤럭시는 공개 자료의 35mm 환산·화각 + S24 영상 보정(1.09)이라 모두 추정치다. 아이폰은 애플이 전면 초점을 공개하지 않아 세대별 실제 영상 기록(12: 25mm, 14 Plus·16 Pro: 24mm, 17 Pro: 20mm)을 같은 사양 기종에 쓴다. 실제 영상으로 확인한 기종만 `measured`로 바꾼다(S15P31B204-358) |
| `none` | 기록이 없거나(메신저 재전송·변환된 영상) 표에 없는 기종 | `focalPx: null`. GPU가 초점을 추정해 형상이 달라질 수 있다 |

GPU 렌즈 단계(`run_all.py` `lens()`)는 출처에 따라 다르게 시도한다(S15P31B204-467). 10-29 운영에서 갤럭시 S26+ 2건이 추정 프로필 값(1390.7px)을 고정 1회로 쓰다 `lens_anchor` exit 2로 실패했고, 프로필이 없던 A52s는 넓은 탐색으로 성공했다.

| 렌즈 값 | 첫 시도 | 실패하면 |
| --- | --- | --- |
| 아이폰 `file`·`same-model file`·`measured` 프로필 | 그 값 고정 1회 | 600~3000px 넓은 탐색(5회) |
| `estimate` 프로필, 갤럭시 렌즈 기록(`focalEstimate`) | 그 값 고정 1회 | 그 값의 0.75~1.35배 탐색(3회) → 그래도 실패하면 600~3000px 넓은 탐색(5회) |
| 없음(`none`) | 600~3000px 넓은 탐색(5회) | - |

첫 시도는 모두 지금처럼 그 값을 고정해서 쓴다. 그래서 그 값으로 통과하던 작업의 결과는 바뀌지 않고, 실패하던 작업만 다음 시도로 넘어간다. 넓은 탐색은 크게 빗나갈 수 있어서(eun02-sam: 탐색 631px, S24 프로필 1559px) 첫 시도로 쓰지 않는다.

묶음에서 돌릴 때는 `frames_bundle.py run`이 `--focal`과 함께 `--focal-estimate`를 넘겨 추정값임을 알린다. 시도한 순서는 `run_all.json`의 `stages.lens.search`에 남는다(예: `["fixed", "near", "full"]`).

원래 파이프라인은 기종 표를 렌즈 단계에서 찾는다. 영상이 추출 직후 지워지므로 `extract`가 같은 규칙(가장 길게 맞는 기종 이름)으로 미리 계산해 넣는다. 영상에 렌즈 기록이 없을 때 같은 기종의 다른 원본에서 값을 빌리는 기능(`same_model_focal35`)은 EC2에 다른 원본이 없어 쓰지 않는다.

### 버전 고정

같은 영상이라도 OpenCV 휠에 들어 있는 영상 디코더 버전이 다르면 다른 프레임이 뽑힌다. Windows 휠(FFmpeg 61.x)과 Linux 휠(62.x)에서 seo01의 프레임 목록·픽셀이 달라졌고, 그 프레임으로 만든 3D와 홀드아웃 점수도 달라졌다. EC2·GPU 서버·RunPod는 Linux + `requirements-extract.txt` 버전으로 맞춘다.

## GPU 복원 (RunPod)

Pod 세팅·워커 실행·코드 교체·워커 수는 [`../runpod/README.md`](../runpod/README.md)에 있다(설치 버전: `requirements-extract.txt` + `runpod/requirements-gpu.txt`, COLMAP 4.2 CUDA, Node.js 18+).

- **연결**: Spring 내부 API(`/internal/*`)는 밖에서 막혀 있다(Caddy 404). 워커는 EC2로 SSH 터널을 열고 `127.0.0.1:28080`(개발)·`18080`(운영)에 붙는다(`RECON_API_BASE`, [EC2 서버](../../../docs/guides/ec2-server.md)).
- **시크릿**: `INTERNAL_API_SECRET`은 EC2 `.env`에서 RunPod Secrets로 바로 옮긴다. 채팅·로그·저장소에 남기지 않는다.
- **GPU 지정**: 공용 GPU 서버에서는 `CUDA_VISIBLE_DEVICES`로 우리 GPU만 쓴다. RunPod에서는 워커별 스레드 수를 `runpod/run-worker.sh`가 CPU 할당에 맞춰 나눈다.
- **설정**: 인계 기준 `--no-lm`(`RECON_ARGS`), 텍스처 포함. 작업 하나 3D 상한 `RECON_TIMEOUT_SEC`(기본 1800초).
- **5방향 사진**: `prepare.json`의 얼굴 각도(yaw, 음수 = 왼쪽)로 고른다. `LEFT`·`RIGHT`는 가장 많이 돌린 프레임, `LEFT_45`·`RIGHT_45`는 ±45°에 가장 가까운 프레임, `FRONT`는 0°에 가장 가까운 프레임이다. 옆모습이 35°에 못 미치거나 정면이 15° 안에 없으면 `FAILED(QUALITY_ANGLE)`. 사진은 묶음 프레임(원본 해상도) 그대로 올린다.
- **결과**: `model/head.glb`(텍스처 내장) 하나를 `mesh`로 올리고 `texture`·`thumbnail`은 보내지 않는다. `qualityReport`에는 숫자만(장 수·초점·선택 후보·홀드아웃 %IOD·단계 시간).
- **헤어라인**: `model/hairline.json`이 있으면 `head.glb`의 `asset.extras["live-mirror"].hairline`에 사람별 헤어라인을 피부 삼각형 기준 점(`[i0, i1, i2, w0, w1]`, `i`는 `_TEMPLATE_INDEX` 번호)으로 담는다. 앱은 `w0·V[i0] + w1·V[i1] + (1−w0−w1)·V[i2]`로 곡선을 다시 그려 헤어를 맞춘다(`tools/glb_hairline.py`, S15P31B204-722). 없으면 키가 없다.
- **얼굴 데이터 삭제**: 작업이 끝나면 성공·실패·취소와 상관없이 묶음, `work/<jobId>`, 편집용 사본 `cases/<jobId>-model`을 지운다.

### 코 편집 형상 진단 (S15P31B204-308)

`node tools/audit_nose.mjs work/<jobId>`는 생성된 `head.glb`와 `rig.json`의 해시·정점 매핑을 확인하고 코 조절의 양쪽 끝값과 대표 복합값을 **최종 GLB 메시**에 적용해 면 뒤집힘·붕괴·과도한 늘어남·새 자기교차를 검사한다. 결과는 로컬 `model/nose_audit.json`에만 저장하며 실제 얼굴 자료는 저장소나 로그에 넣지 않는다. `--evaluate-only`는 파일을 쓰지 않는다.

이 진단은 일부 표본값 검사다. `sampleChecksPassed=true`여도 모델별 지원 확정이나 `chat_apply_ready=true`의 근거가 되지 않는다. 전체 범위·비대상 부위·미관 검사, 복합값별 서버 재검증, BE/FE 계약 연결이 완료될 때까지 채팅 적용은 닫아 둔다.

`nose_audit.json` v2는 원본 GLB·리그의 SHA-256 및 엔진·위상 버전을 묶는다. `sampledRanges`는 각 코 효과를 0에서 양·음 방향으로 0.1씩 독립 검사해 첫 실패 직전까지 기록한 **진단값**이다. `checkFailures`·`sampledFailures`·`combinedResults`에는 실패한 표본의 정규 메시·최종 피부 메시 검사 결과와 새 자기교차 수를 남긴다. 예상 밖 검사 오류는 보고서를 쓰지 않고 중단한다. 실패 뒤 더 큰 값은 검사하지 않는다. 복합 효과나 표본 사이 값의 안전을 보장하지 않으며 `approvedForService`는 항상 `false`다. 이 파일만으로 capabilities나 `chat_apply_ready`를 열지 않는다. 실제 요청 상태 전체는 아래 명령으로 별도 검사한다.

`node tools/nose_approval_evidence.mjs work/<jobId>/model`은 1차 UI 코 코드 5종의 방향별 표본 범위, 쌍별 끝값, 지원된 모든 코드의 끝값 조합을 읽기 전용으로 검사한다. 출력에는 원본·리그 해시와 첫 실패·복합 실패를 남기지만 `approvedForService=false`다. 표본 사이 값, 비대상 부위 이동·미관은 이 명령이 승인하지 않는다. 3D 담당자가 범위와 실제 화면을 검토한 뒤에도 Spring은 편집 요청마다 최종 메시를 다시 검사한다. 실제 얼굴 파일이나 보고서는 저장소에 넣지 않는다.

`node tools/check_nose_edit.mjs work/<jobId>/model '{"nose.bridge_height":0.4}'`는 **요청한 코 가중치 전체**를 원본 리그에서 계산해 최종 GLB 피부 메시의 뒤집힘·붕괴·늘어남·새 자기교차를 확인한다. 코 외 코드는 0이어도 거절한다. 성공은 종료 코드 0, 실패는 1이다. FE와 같은 공개 코드 대응표·부호별 모델 한계를 쓰고 모델/리그 해시·버전을 결과에 포함한다. 이 명령은 상태를 저장하지 않으며, 서버가 동일한 모델·리그·요청 상태를 검증한 뒤 실제값과 함께 한 거래로 저장하기 전에는 채팅 적용을 열 수 없다.

신규 모델은 결과 보고 전에 `node tools/auto_nose_candidate.mjs work/<jobId>/model`로 중립 상태와 코드별 양방향 끝값을 검사한다. 형상 검사에 실패한 방향은 마지막 합격값과 첫 실패값 사이를 최대 세 번 더 확인한다. 복합 조합은 편집 시 검사한다. 승인 범위와 실패 시 처리 기준은 [코 승인 계약](../../../contracts/edit/nose-approval-v1.md)을 따른다. 기존 무리그 모델은 아래 복원 절차를 거친 뒤 별도 검토한다.

### 기존 생성 모델의 코 리그 복원 (S15P31B204-308)

리그가 없지만 `head.glb`에 `live-mirror` 메타데이터와 `_TEMPLATE_INDEX`가 남은 모델은 `python tools/backfill_nose_rig.py <기존 head.glb> <새 rig.json>`으로 코 전용 리그를 다시 만들 수 있다. Python의 NumPy·SciPy·Pillow와 Node.js가 필요하다. 원본 GLB와 기존 리그를 덮어쓰지 않으며, 임시 원본·리그는 개인 얼굴 자료로 취급해 서버 내부에서만 처리한다.

복원은 **편집 승인과 별개**다. 새 리그를 원본 GLB에 묶어 최종 메시의 단일·복합값, 비대상 부위 이동, 화면 품질을 모델별로 확인해야 한다. 안전 범위가 없으면 해당 모델을 열지 않는다. 검증된 리그만 모델의 `rig_object_key`에 연결하고 기존 내부 승인 API로 범위를 확정한다. DB 플래그를 직접 바꾸지 않는다.

## 검증

- CI: `services/gpu-worker/tests/test_frames_bundle.py`. 확장자 없는 영상 판별, 렌즈 우선순위, 묶음 검사(체크섬·목록 밖 파일·품질 실패·형식)를 합성 데이터로 본다.
- CI: `ai:mesh-test`가 합성 GLB·삼각형의 최종 메시 변형과 자기교차 회귀를 Node.js 20에서 검사한다.
- 실제 영상(CI 밖, 2026-10-26 수동): 아이폰 영상(88장, `focalPx` 1221.9 `file`), 삼성 S24+ 영상(82장, 1558.8 `device profile`)을 확장자 없는 `input` 이름으로 추출해 exit 0·`frames`를 확인했다. 같은 묶음으로 만든 3D가 영상 입력으로 만든 3D와 같았다(형상 차이 중앙값 0.17%IOD, 홀드아웃 프레임 동일). CPU 4코어 제한 추출 시간 13.5~18.4초(노트북 기준, EC2는 더 걸릴 수 있다).
- 실제 얼굴 영상·프레임은 저장소와 테스트에 넣지 않는다.

## 변경 이력

| 날짜 | 이슈 | 변경 |
| --- | --- | --- |
| 2026-10-27 | S15P31B204-308 | 최종 GLB 코 편집 표본 형상 진단 명령과 지원 판정 제한을 추가했다. |
| 2026-10-27 | S15P31B204-308 | 요청 상태 1건의 최종 GLB 형상 검사 명령과 FE 공유 코 효과 대응표를 추가했다. |
| 2026-10-27 | S15P31B204-308 | 모델별 방향별 표본 범위를 진단 보고서에 추가하고 서비스 승인과 구분했다. |
| 2026-10-28 | S15P31B204-308 | 1차 코 코드의 쌍별 끝값과 첫 실패를 읽기 전용 승인 근거로 출력한다. |
| 2026-10-28 | S15P31B204-257 | RunPod 설치·실행 절차를 `runpod/README.md`로 옮기고, 지금 쓰지 않는 `LM_THREADS`·`LM_CPUSET` 안내를 뺐다. |
| 2026-10-28 | S15P31B204-308 | 기존 GLB의 전체 템플릿 형상에서 코 전용 리그를 복원하는 명령과 승인 조건을 추가했다. |
| 2026-10-28 | S15P31B204-123 | 신규 생성 모델의 코 보수 범위 자동 후보와 Spring 재승인 연결을 추가했다. |
| 2026-10-28 | S15P31B204-308 | 신규 모델의 코 자동 승인 범위를 기본 모델의 ±1까지 순차 검사해 가장 넓은 통과 범위로 정한다. |
| 2026-11-08 | S15P31B204-664 | 코 편집 범위가 없어도 중립 검사가 통과한 모델은 결과로 보고한다. |
