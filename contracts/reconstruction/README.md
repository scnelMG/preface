# 3D 복원 워커 계약 (INT-REC-01~04)

> 최종 갱신: 2026-11-15

Spring(BE)과 GPU 워커(AI)가 3D 복원 작업을 주고받는 형식이다. 워커는 이 폴더만 보고 만들 수 있어야 한다.
원본: API 명세서 v2.7 "7. 내부 API". **명세 v2.7과 다른 점**은 맨 아래 "명세와 다른 점"에 적는다.

| 파일 | 내용 |
| --- | --- |
| `openapi.yaml` | INT-REC-01 작업 가져가기(claim), 02 진행 보고, 03 결과 보고, 04 결과 업로드 URL (OpenAPI 3.1) |
| `schemas/*.schema.json` | 요청·응답 본문(JSON Schema 2020-12). `openapi.yaml`이 참조한다 |
| `fixtures/*.json` | 합성 예시(실제 얼굴·회원 데이터·서명 URL 아님). 이름이 같은 스키마로 검증된다 |

## 왜 pull인가

GPU 워커는 Runpod(미국)·VPN 안에 있고, Spring이 있는 EC2는 외부에 22·80·443·8080만 연다. Redis는 외부에 열지 않는다.
그래서 워커가 Redis에 직접 붙지 않고 **Spring HTTPS API로 작업을 하나씩 가져간다**. 워커는 Redis·MySQL·S3 자격 증명을 갖지 않고,
파일은 Spring이 발급한 presigned URL(만료 10분)로만 내려받고 올린다.

**입력은 원본 영상이 아니라 프레임 묶음이다(S15P31B204-353).** EC2 프레임 추출 워커가 영상에서 프레임·마스크·선택 정보·렌즈 정보를
묶음 tar 1개로 만들고, 원본 영상은 그 직후 지운다. 추출 단계와 묶음 형식은 [`contracts/frame-extraction`](../frame-extraction/README.md).

## 흐름

```text
FE 업로드 완료 → Spring: reconstruction_job(QUEUED) 커밋 → 프레임 추출(contracts/frame-extraction)
  → 묶음 저장·원본 영상 삭제 예약 커밋 → Redis LPUSH recon:jobs <jobId>

워커 루프:
  POST /internal/v1/reconstruction-jobs/claim {workerId}
    204 → 3~5초(지터) 쉬고 다시
    200 → input.downloadUrl로 프레임 묶음(tar)을 바로 내려받고 checksumSha256 확인, input.lens.focalPx 사용
        → 단계 시작마다 + heartbeatIntervalSec마다 POST .../progress
        → 결과를 만들면 POST .../output-urls → 받은 시도별 PUT URL로 업로드(headers 그대로)
          (메시·선택적 코 리그·텍스처·썸네일 + 5방향 얼굴 사진 captures.FRONT·LEFT·RIGHT·LEFT_45·RIGHT_45)
        → POST .../result (SUCCEEDED 또는 FAILED) → 로컬 임시 파일 삭제
```

## Spring 안의 큐 (워커는 몰라도 된다)

- `recon:jobs`(list, 대기) → claim 때 `LMOVE recon:jobs recon:processing RIGHT LEFT`로 원자적으로 옮긴다.
  `recon:claim:{jobId}`(hash)에 `workerId`·`claimedAt`·`lastSeenAt`·`attempts`를 둔다.
- 결과 보고(INT-REC-03)가 DB에 커밋된 뒤에 `recon:processing`에서 지운다. 그래서 워커가 처리 중 죽어도 작업이 사라지지 않는다.
- 값은 jobId 하나다. 작업 정보는 claim 때 DB에서 읽어 만든다(큐와 DB가 어긋나도 DB가 원본).
- **List + LMOVE를 고른 이유**: 소비자가 워커가 아니라 Spring이라, Streams consumer group의 소비자별 PEL·XAUTOCLAIM이 주는 이점이 적다.
  처리 중 목록 + 메타 hash면 회수 규칙(아래)을 그대로 표현할 수 있고 명령이 단순하다(LMOVE·LREM, Redis 6.2+).
  대신 처리 중 목록 조회가 O(N)이지만 동시 작업 수(= GPU 워커 수)가 작아 문제없다.

## 상태와 회수 규칙

```text
QUEUED ──claim──▶ RUNNING ──result(SUCCEEDED)──▶ SUCCEEDED
   ▲                 │    └─result(FAILED)────▶ FAILED
   └──회수(1회)───────┤
                     └─회수(2번째)──────────▶ FAILED(TIMEOUT)
삭제·탈퇴·동의 철회 ─▶ CANCELED (Spring이 바꾼다)
```

- **heartbeat**: claim 응답의 `heartbeatIntervalSec`(가정 120초)마다 progress를 한 번 이상 보낸다.
- **lease**: 마지막 claim·progress 뒤 `leaseTimeoutSec`(가정 600초)가 지나면 Spring이 작업을 회수한다.
  - 첫 회수: 다시 `QUEUED`로 돌려 대기열 뒤에 넣는다(명세 "1회 재큐잉").
  - 두 번째 회수: `FAILED`, `failCodes=["TIMEOUT"]`, 사용자 알림.
  - 회수된 작업에 이전 워커가 보고하면 progress는 `continue=false`, output-urls·result는 409 `REC_022`.
- 회수 스케줄러는 Spring 쪽 별도 작업이다(이 계약의 동작만 약속한다).
- **대기 시간 초과**(S15P31B204-528): 프레임 준비 뒤(또는 회수·재시도로 `QUEUED`에 돌아온 뒤) 설정 시간(가정 20분) 동안 아무 워커도 claim하지 않으면 Spring이 `FAILED`, `failCodes=["TIMEOUT"]`, 사용자 알림으로 끝낸다. GPU Pod가 꺼져 있을 때 사용자가 끝없이 기다리지 않게 하려는 것이다. 단, 처리 중인 작업 중 하나라도 lease 안에 claim·progress가 있으면(워커가 일하는 중) 밀린 대기로 보고 끝내지 않는다. 워커 쪽 동작은 바뀌지 않는다(끝난 작업은 claim에 나오지 않는다).
- **대기열 맞추기**(S15P31B204-593): Spring은 DB 커밋 뒤에 `recon:jobs`에 넣으므로, 그 사이 api가 죽거나 Redis 오류가 나면 DB에는 GPU 대기인데 대기열에는 없는 작업이 남는다. job-manager가 1분마다 GPU 대기 작업 중 마지막 변경 뒤 2분이 지났는데 `recon:jobs`와 `recon:processing` 어디에도 없는 것을 대기열 뒤에 다시 넣는다. 겹쳐 두 번 들어가도 claim이 중복을 건너뛴다.
- **INTERNAL 재시도**(S15P31B204-377): result가 `FAILED`이고 `failCodes`가 `["INTERNAL"]`뿐이며 시도 횟수(claim 기록 `attempts`)가 `maxAttempts`(2) 미만이면 Spring은 결과를 확정하지 않고 다시 `QUEUED`로 돌려 대기열 뒤에 넣는다(응답은 200, `faceModelId` 없음, 사용자 알림 없음). 시도 횟수는 lease 회수와 합쳐 센다. 두 번째 시도의 `INTERNAL`은 그대로 `FAILED`.
  - `FIT_FAILED`·`QUALITY_*`(사진 문제)와 `TIMEOUT`, 그리고 다른 코드가 섞인 실패는 재시도하지 않는다.
  - 워커는 프로그램 문제(신호 종료·하위 프로그램 오류)만 `INTERNAL`로 보고한다(S15P31B204-381). 사진 단계 프로그램이 사진으로는 카메라를 못 푼다고 일부러 끝낸 경우(`lens_anchor` 2, `sfm_sparse` 2·3)는 `FIT_FAILED`다(S15P31B204-466). 재시도된 뒤 같은 result를 다시 보내면 409 `REC_022`이므로 버린다.
  - 3D 생성이 끝까지 됐으면 카메라 위치 검사(고개를 돌린 쪽에서 SfM 회전이 MediaPipe보다 작음)가 실패해도 결과를 돌려준다. 판정은 성공 결과 `qualityReport.poseCheck`·`poseNote`에 남긴다. 회전 부족은 촬영 중과 업로드 직후(`QUALITY_ANGLE`)에 미리 알린다(S15P31B204-663).

| 지금 상태 | progress | output-urls | result 같은 status | result 다른 status |
| --- | --- | --- | --- | --- |
| RUNNING(이 워커) | 200 `continue=true` | 200 | 200 처리 | 200 처리 |
| RUNNING(다른 워커)·QUEUED(회수됨) | 200 `continue=false` | 409 `REC_022` | 409 `REC_022` | 409 `REC_022` |
| SUCCEEDED / FAILED | 200 `continue=false` | 409 `REC_021` | 200 처음 결과 그대로(멱등) | 409 `REC_021` |
| CANCELED | 200 `continue=false` | 409 `REC_020` | 409 `REC_020` | 409 `REC_020` |

## 워커가 할 일

| 응답 | 워커 동작 |
| --- | --- |
| 200 `continue=false` | 즉시 멈추고 로컬 임시 파일을 지운다. result는 보내지 않는다. 올린 S3 출력은 Spring 삭제 작업이 정리한다 |
| 409 `REC_020`·`REC_022` | 로컬 임시 파일을 지우고 작업을 버린다. 올린 S3 출력은 Spring이 정리한다 |
| 409 `REC_021`, 404 `COMMON_002` | 재시도하지 않고 작업을 버린다(로그만) |
| 코 승인 증거를 보낸 성공 보고에서 result 503 `REC_023` | 5초 뒤 같은 시도의 업로드와 `noseApproval`로 성공 보고를 한 번 재시도한다. 다시 `REC_023`이면 아래와 같이 코 승인 없이 모델을 등록한다 (S15P31B204-725). |
| 코 승인 증거를 보낸 성공 보고에서 result 409 `EDIT_031`·`EDIT_032` 또는 재시도 후 503 `REC_023` | 같은 시도의 업로드를 그대로 사용하고 `noseApproval`을 빼 성공을 한 번 다시 보고한다. `qualityReport.noseCheck`에 응답 코드를 기록하고 코 편집만 잠근다 (S15P31B204-664·725). |
| 그 밖의 result 409 | 작업은 아직 이 워커 것이지만 결과를 받지 못한다. `FAILED(INTERNAL)`로 바로 다시 보고한다(`debugMessage`에 코드). 이미 실패 보고였다면 다시 보내지 않는다 (S15P31B204-582) |
| 400 `COMMON_001` | 본문 버그. 재시도해도 같으므로 `FAILED(INTERNAL)`로 다시 보고한다 |
| 401 `AUTH_001` | 시크릿 설정 오류. 재시도하지 말고 알린다 |
| 5xx·네트워크 오류 | 같은 본문으로 재시도한다. 1·2·4·8·16초 뒤, 그다음 15초 간격으로 result는 최대 약 5분까지(`JOB_API_WAIT_SEC`). lease 안에 끝내야 한다 |

## 5방향 얼굴 사진 (v2.9, S15P31B204-301)

- 설문·피드백 분석에 쓰려고 3D와 함께 **실물 사진 5장을 영구 보관**한다(탈퇴·얼굴 동의 철회·3D 삭제 시 함께 삭제).
- 워커가 프레임 묶음에서 각 방향을 가장 잘 보여 주는 프레임을 1장씩 고른다: `FRONT`(정면), `LEFT`(좌 90°), `RIGHT`(우 90°), `LEFT_45`, `RIGHT_45`.
  원본 영상은 GPU 워커에 오지 않는다(S15P31B204-353).
  - 각도는 3D 생성의 SfM 시점 각도(`model/view_coverage.json`, 얼굴이 안 보이는 옆모습 포함)로 고른다. MediaPipe 각도(`prepare.json`)는 75°를 넘으면 얼굴을 못 찾아 측면 사진이 실제 51~78°였다. 고개 상하(pitch)도 함께 본다: (목표 yaw, pitch 0)에 각도 거리가 가장 가까운 프레임을 고른다. yaw만 보면 고개를 든·숙인 프레임이 정면으로 뽑혔다. 그 거리가 정면 10°, 45° 10°, 90° 20°를 넘으면(그쪽 복원이 틀린 경우) 그 방향만 MediaPipe 각도로 고른다. 성공 결과 `qualityReport.captureViews`에 방향별 SfM yaw·pitch와 고른 방식을 남긴다. 회전 부족 판정(`QUALITY_ANGLE`)은 그대로 MediaPipe 각도다(S15P31B204-666).
- 성공 결과 `qualityReport.captureCameras`(선택): 5방향 사진을 찍은 카메라를 업로드한 `mesh.glb` 좌표로 보낸다. 관리자 화면이 사진과 3D를 같은 시점에서 겹쳐 비교한다(S15P31B204-705).
  - `frame: "glb"`(export_glb의 `world_to_glb` 적용 뒤 GLB 좌표, 단위 = GLB 단위), `axes: "colmap"`(`x_cam = R · X_glb + t`, 카메라 축 x 오른쪽·y 아래·z 앞).
  - `camera` `{w, h, f, cx, cy}`: 업로드한 사진(prep 이미지 원본, 자르기·크기 변경 없음)의 픽셀 단위 렌즈값. 모든 사진이 같은 카메라다(왜곡 계수는 빠짐).
  - `views`: 5방향 키가 모두 있고 값은 `{R: 3×3, t: [x, y, z]}`. 그 사진이 3D 생성에서 등록되지 않았거나 버려졌으면 `null`. R은 소수 6자리, t·camera는 4자리. 파일 이름·경로·URL은 넣지 않는다.
  - 출처는 파이프라인의 `model/frames.json`(`tools/glb_frames.py`, head.glb 내보낸 직후). 워커의 윤곽 굽기는 morph target만 더해 기본 형상·좌표가 같다. 파일이 없거나 읽지 못하면 키를 빼고 작업은 그대로 성공한다.
- 형식 JPEG(`image/jpeg`), 원본 해상도·회전 보정 후 저장. 얼굴 이외 배경을 자르지 않는다(가공 규칙은 AI 파트가 정하면 여기 추가).
- INT-REC-04 `captures.<ANGLE>`로 받은 URL에 올리고, INT-REC-03 성공 보고의 `captureImages.<ANGLE>`에 그 `objectKey`를 그대로 넣는다. **5장 모두 필수** — 하나라도 없으면 400.
- 각도를 못 찾으면(예: 옆얼굴 구간 없음) 성공으로 보고하지 말고 `FAILED` + `QUALITY_ANGLE`로 보고한다.
- 사진은 서버가 사용자에게 보여 주지 않는다(조회 API 없음). LLM에도 보내지 않는다.

## 값 규칙

- 인증: 모든 요청에 `X-Internal-Secret`. 작업별 요청(02~04)에는 claim 때와 같은 `X-Worker-Id`.
- 출력 key는 claim 응답의 시도별 `outputPrefix`(`users/{userId}/models/{jobId}/a{attempt}/`) 아래 INT-REC-04가 발급한 해당 파일의 `objectKey`와 정확히 같아야 한다. 아니면 400. 이전 시도의 메시·리그·사진 key는 현재 시도의 결과 보고에서 받지 않는다.
- claim의 소유자·시도 횟수가 확인될 때만 INT-REC-04 URL을 발급한다. 시도 메타가 사라졌다면 `REC_022`를 반환한다.
- `morphSchemaVersion`은 claim 응답 값을 그대로 돌려준다.
- `failCodes`: `QUALITY_NO_FACE`·`QUALITY_ANGLE`·`QUALITY_LIGHT`·`QUALITY_COMPRESSED`·`FIT_FAILED`·`TIMEOUT`·`INTERNAL`. 사용자 문구는 FE가 코드별로 만든다.
- `videoMeta`는 스키마에 있는 키만 저장한다. 위치(GPS)는 보내지 않는다. 영상 정보는 추출 워커가 이미 보고하므로 GPU 워커는 보내지 않아도 된다.
- `input.frameCount`는 묶음 `images/` 장 수다. 최대 100장이고 고정이 아니다(82~97장처럼 달라진다).
- 진행 단계 `FRAME_SELECT`는 추출 워커가 하는 일이라 GPU 워커는 보고하지 않는다. GPU가 가져갈 때 단계는 이미 `QUALITY_CHECK`(추출 끝)다(`contracts/frame-extraction` "흐름", S15P31B204-375).
- `measurements`·`qualityReport`는 숫자·짧은 문자열 객체(각 64KB 이하). 이미지·영상·서명 URL·토큰은 어느 필드에도 넣지 않는다. `debugMessage`도 같다.
- 3D 생성 실패 보고(`FIT_FAILED`·`TIMEOUT`·`INTERNAL`)의 `qualityReport.diag`: 원본과 작업 폴더가 지워져도 실패 원인을 볼 수 있게 남기는 진단 숫자. `frames`는 고른 프레임마다 `cols`(`tMs` 영상 시각, `mpYaw`·`mpPitch` MediaPipe 각도, `face` 1/0, `sfmYaw`·`sfmPitch` SfM 시점 각도, 미등록이면 null) 순서의 배열이고, `rejected`(버린 프레임 수), `noFaceKept`, `lensTrials`, `viewCoverage`, `holdoutPctIod`, `poseCheck`, `notes`(200자 이하 5개)가 함께 온다. 파일 이름·경로·이미지는 넣지 않는다. 100장 기준 약 5KB. 녹화 전체 각도 곡선은 `captureTrace`로 따로 저장된다 (S15P31B204-663, 계획 S1-5).
- 현재 생산 워커는 검증된 얼굴 측정값을 만들지 않아 `measurements`를 생략한다. 합성 성공 예시도 빈 객체다. 측정 산식·단위·품질·원본/편집 후 구분과 모델 결속을 실제 생성 모델에서 확인하기 전에는 길이를 mm로 채우거나 GMS에 보내지 않는다(S15P31B204-88·122).
- `eyeReview`는 새 GLB의 눈별 주름 판정(`L`·`R`: `present|absent`)과 같은 값이다. `eyePartsSha256`은 판정에 쓴 원본 `eye_parts.json` 바이트 해시이며 GLB의 `eye_parts_sha256`과 같다. 둘 중 하나라도 없으면 눈 승인·편집을 잠근다. 눈 편집 저장 문턱은 [`eye-state-v1`](../edit/eye-state-v1.md)을 따른다.
- `eyeApproval`(선택)은 눈 승인 한계 후보다. `binding`은 최종 메시·리그 해시와 엔진·리그·위상 버전에 `eyePartsSha256`을 더한 값이고, `limits`는 워커가 브라우저와 같은 엔진(`engine/eye-edit.mjs`)으로 잰 단독 안전 한계(0~100)다. 쌍꺼풀 높이(`<종류>:height`)는 무쌍(`absent`) 눈이 있을 때만 있다. Spring은 결속·판정이 맞을 때만 `face_model.approved_eye_capabilities`로 저장한다. 코 승인이 없는 경우에는 저장 전에 눈 검사기로 실제 자산을 확인한다. 눈 증거가 없거나 맞지 않으면 눈 편집만 잠근다.
- 서명 URL(`downloadUrl`·`uploadUrl`)과 시크릿은 워커 로그에도 남기지 않는다.

## 코 편집 리그 산출물 (S15P31B204-308)

- INT-REC-04의 `rig`는 로컬 `rig.json`의 업로드 URL이다. 메시·리그·텍스처·썸네일·사진 모두 GPU 시도별 `a{attempt}/` 경로로 분리한다. 성공 보고에는 발급받은 `rigObjectKey`가 필요하다. 원본 피부가 정상이고 안전한 코 편집 범위가 없거나 코 편집에 필요한 보호 영역이 빠졌으면 워커는 `noseApproval`을 생략하고 `qualityReport.noseCheck`에 이유를 남긴다. Spring은 모델을 등록하고 코 편집을 잠근다. 체중 변화는 등록할 GLB의 자체 검증을 통과하면 사용할 수 있다. 워커가 정상 원본을 확인할 수 없으면 실패로 보고한다.
- 리그는 얼굴 형상 개인 데이터다. Spring은 key를 해당 `face_model`에 저장하고 3D 보관기간 종료·탈퇴 때 메시와 함께 삭제한다. 구 모델과 구 워커의 결과에는 key가 없을 수 있다.
- 작업이 실패·최종 시간 초과·취소되면 모든 시도의 예상 출력 key 삭제를 예약한다. 성공 시에는 저장한 출력만 남기고 다른 시도·누락 출력 key를 삭제 예약한다. 모델 삭제·탈퇴·보관기간 만료 시에도 저장된 출력 key를 삭제 예약한다. 발급된 PUT URL의 늦은 업로드를 놓치지 않도록 복원 출력 삭제는 예약 후 1시간이 지나야 실행한다. S3 삭제 실패는 기존 삭제 기록의 재시도 정책을 따른다.
- Spring은 모델 저장과 코 범위 재검증·승인을 한 거래에서 끝낸다. 승인 실패 시 생성 성공도 롤백된다. 저장 요청마다 복합값의 최종 메시를 다시 검사한다. 기존 생성 모델의 무리그 상태는 별도 복원·검증 대상이다.
- 배포 순서: 진행 중인 GPU 작업이 끝난 뒤 개발 워커를 잠시 멈추고 BE를 올린 다음 같은 커밋의 워커를 교체해 다시 켠다. 구 워커가 새 BE에 성공 결과를 보고하면 필수 승인 증거가 없어 거절되며, 새 워커가 구 BE에 먼저 보고하면 완료됐지만 잠긴 모델이 생길 수 있다.

## 표정 트래킹 리그 산출물 (S15P31B204-879)

- 편집실 표정 트래킹은 모델마다 표정 리그(`expression.json`)가 있어야 켜진다. `rig.json`은 코·눈 승인이 파일 해시로 묶여 있어 고치지 않고 별도 파일로 둔다.
- INT-REC-04 응답의 `expression`(선택)은 같은 시도 경로(`a{attempt}/expression.json`)의 업로드 URL이다. 워커는 이 항목이 **있을 때만** 업로드할 최종 메시·리그로 표정 리그를 만들어 올리고, 성공 보고에 그 `objectKey`를 `expressionObjectKey`로 넣는다. 항목이 없는 이전 백엔드에는 만들지 않는다.
- 표정 리그를 만들지 못하면 `expressionObjectKey`를 빼고 성공을 보고한다. 생성은 성공이고 편집실의 표정 트래킹만 꺼진다.
- `expressionObjectKey`가 있으면 발급한 key와 정확히 같아야 한다(아니면 400). Spring은 `face_model.expression_object_key`에 저장하고 모델 상세(API-HIS-02) `expressionUrl`로 10분 서명 URL을 준다. 공유 화면에는 주지 않는다.
- 표정 리그도 얼굴 형상 개인 데이터다. 코 편집 리그와 같이 모델 삭제·탈퇴·보관기간 만료 때 삭제 예약하고, 실패·버린 시도의 `expression.json`도 다른 출력과 함께 삭제 예약한다.
- 기존 모델 보충: 내부 요청 `POST /internal/v1/face-models/{faceModelId}/expression-rig` 본문 `{"objectKey": "..."}`(`X-Internal-Secret`). key는 그 모델 메시와 같은 폴더의 `expression.json`이어야 하고(아니면 400 `COMMON_001`, 없거나 지운 모델은 404 `COMMON_002`), 같은 key로 다시 불러도 성공이다. 코·눈 승인과 시안은 바꾸지 않는다.

## 바꿀 때

- 선택 필드 추가는 하위 호환이다. 필드 삭제·이름 변경·필수 추가·enum 값 삭제는 깨지는 변경이라 BE·AI가 함께 바꾼다.
- 스키마를 바꾸면 fixture와 Spring 구현(`services/backend` reconstruction 도메인)을 같은 MR에서 고친다.

## 명세와 다른 점 (API 명세서 v2.7 수정 필요)

| 항목 | 명세 v2.7 | 이 계약 |
| --- | --- | --- |
| INT-REC-01 | Redis `recon:jobs` LPUSH/BRPOP, 워커가 직접 BRPOP | 워커가 `POST /internal/v1/reconstruction-jobs/claim`으로 pull. Redis는 Spring 안에서만(LMOVE → `recon:processing`) |
| 큐 메시지 | `{jobId, userId, uploadObjectKey, outputPrefix, morphSchemaVersion, enqueuedAt}` | claim 응답 `{jobId, input{downloadUrl…}, outputPrefix, morphSchemaVersion, claimedAt, heartbeatIntervalSec, leaseTimeoutSec}`. userId·object key는 주지 않는다 |
| QUEUED → RUNNING | 첫 progress | claim |
| INT-REC-04 | 없음 | 결과 업로드 presigned PUT 발급 [제안] (워커에 S3 자격 증명을 주지 않기 위해) |
| 재큐잉 | 하트비트 끊기면 1회 [제안] | lease 600초 [가정], 1회 재큐잉 후 FAILED(TIMEOUT) |
| 인증 | `X-Internal-Secret` + 사설망 [가정] | `X-Internal-Secret`(외부 노출 경로라 필수) + `X-Worker-Id` |
| 에러 | `REC_020` | `REC_021`(다른 결과 이미 기록) [제안], `REC_022`(재배정됨) [제안], `REC_023`(결과 검사 일시 불가, 503) [제안] 추가 |
| 결과 본문 | — | `morphSchemaVersion` 필수 추가 |
| 5방향 사진 | — | INT-REC-04 `captures`, INT-REC-03 `captureImages` 필수(v2.9 신설) |
| INT-REC-01 입력 | 원본 영상 presigned GET | 프레임 묶음(tar) presigned GET + `frameCount`·`lens`. 원본 영상은 EC2 추출 직후 삭제(S15P31B204-353) |

## 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-10-27 | INT-REC-03/04의 선택적 코 리그 업로드·보관·삭제 경계 추가 (S15P31B204-308) |
| 2026-10-27 | 결과 보고 전 실패·취소와 업로드 URL 만료를 고려한 리그 정리 시점 추가 |
| 2026-10-27 | 재시도별 전체 출력 S3 key 분리와 모델 삭제의 지연 삭제 경계 추가 |
| 2026-10-28 | 신규 성공 결과에 코 리그·승인 증거를 필수로 하고 모델 등록과 편집 승인을 한 거래로 묶었다 (S15P31B204-123) |
| 2026-10-30 | 사진 단계 프로그램의 의도된 실패 종료(`lens_anchor` 2, `sfm_sparse` 2·3)를 `FIT_FAILED`로 보고한다(재시도 없음) (S15P31B204-466) |
| 2026-11-01 | 선택적 눈별 주름 판정을 성공 결과에 추가했다. 누락된 모델은 눈 기능 잠금을 유지한다 (S15P31B204-509) |
| 2026-11-02 | 프레임 준비 뒤 설정 시간(가정 20분) 동안 claim되지 않은 작업을 Spring이 `FAILED(TIMEOUT)`으로 끝낸다 (S15P31B204-528) |
| 2026-11-02 | 대기 시간 초과는 일하는 워커가 없을 때만 적용한다(작업이 몰려 밀린 대기는 기다린다) (S15P31B204-528) |
| 2026-11-06 | 추출 대기도 job-manager가 시간 초과로 끝내고(시도를 다 썼거나 20분 동안 아무도 안 가져감, `contracts/frame-extraction`), DB와 어긋난 GPU 대기열을 1분마다 맞춘다 (S15P31B204-593) |
| 2026-11-04 | 미검증 mm 측정값을 합성 성공 예시에서 빼고 측정값 발행 전 검증 조건을 명시했다 (S15P31B204-88) |
| 2026-11-04 | 워커는 result 409 중 `REC_020`·`REC_021`·`REC_022`만 버리고, 그 밖의 409(코 편집 검사 실패 등)는 `FAILED(INTERNAL)`로 바로 보고한다 (S15P31B204-582) |
| 2026-11-05 | 코 편집 검사기가 바쁘거나 장애라 결과를 검사하지 못하면 Spring은 409 `EDIT_031` 대신 503 `REC_023`을 준다. 워커는 3D를 다시 만들지 않고 같은 결과를 다시 보낸다. 형상 검사 실패(`EDIT_031`·`EDIT_032`)는 그대로다 (S15P31B204-592) |
| 2026-11-08 | 카메라 위치 검사 판정을 성공 결과 `qualityReport.poseCheck`·`poseNote`에 남긴다(결과는 돌려준다) (S15P31B204-663) |
| 2026-11-08 | `qualityReport.face`(홀드아웃 점·윤곽·측면 오차 %, 주름 p95)와 `qualityReport.head`(두상 비율 4개, 통계 범위 0.5~99.5% 밖 항목)를 나눠 남긴다 (S15P31B204-676) |
| 2026-11-08 | 3D 생성 실패 보고의 `qualityReport.diag`에 프레임별 각도 숫자를 남긴다(이미지 없음) (S15P31B204-663) |
| 2026-11-08 | 5방향 사진을 SfM 시점 각도로 고른다(측면이 실제 90° 근처). SfM이 그쪽을 잘못 복원했으면 그 방향만 MediaPipe 각도 (S15P31B204-666) |
| 2026-11-08 | 원본 피부가 정상이라면 코 검사에서 실패해도 모델을 등록한다. 결과 보고에서 코 검사 오류가 나도 같은 업로드로 성공을 다시 보고한다. 눈·체중은 각각 자산을 확인한다 (S15P31B204-664) |
| 2026-11-09 | 성공 결과 `qualityReport.captureCameras`(선택)에 5방향 사진의 카메라 포즈·렌즈를 mesh.glb 좌표로 남긴다. 없는 사진은 `null`, 원본 파일이 없으면 키를 뺀다 (S15P31B204-705) |
| 2026-11-09 | 코 검사 일시 불가(`REC_023`)에서는 같은 승인 증거를 한 번 더 보낸다 (S15P31B204-725). |
| 2026-11-15 | INT-REC-04 `expression`(선택)과 INT-REC-03 `expressionObjectKey`(선택)로 표정 트래킹 리그를 올리고 저장한다. 기존 모델 보충용 내부 요청을 추가했다 (S15P31B204-879) |
