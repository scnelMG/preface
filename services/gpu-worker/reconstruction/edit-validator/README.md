# 코·눈 편집 CPU 검사기 (S15P31B204-72, S15P31B204-509)

코 계약과 성공/실패 경계는 [INT-AI-02 v1](../../../../contracts/edit/int-ai-02-v1.md)을 따른다. 이 디렉터리는 서비스에서 요청한 **코 전체 상태**를 원본 GLB·리그의 최종 피부 메시로 검사한다. 상담 문장 해석은 Spring이 담당한다.

```sh
docker build -f services/gpu-worker/reconstruction/edit-validator/Dockerfile -t preface-edit-validator services/gpu-worker/reconstruction
# 사설 Docker 네트워크에서 EDIT_VALIDATOR_SECRET·EDIT_ASSET_HOST를 제공해 실행한다.
```

`EDIT_ASSET_HOST`는 Spring이 발급하는 S3 서명 GET URL의 호스트명(필요하면 포트 포함)이다. 검사기는 외부 공개 포트를 열지 않아야 한다. 컨테이너는 한 번에 편집 1건만 처리하고, 작업 스레드를 중단할 수 없는 오류에는 종료한다. 배포 구성에서 `restart: unless-stopped`와 Spring 호출 시간 제한을 함께 설정해야 한다.

검사 중에 들어온 요청은 거절하지 않고 도착 순서대로 기다린다(S15P31B204-592). 3D 생성 결과 1건이 검사를 약 11번(1회 약 2.3초) 부르므로, 바로 거절하면 다른 생성 결과나 사용자 편집이 밀려났다. 기다리는 시간과 수는 `EDIT_VALIDATOR_QUEUE_WAIT_MS`(기본 30000)·`EDIT_VALIDATOR_QUEUE_MAX`(기본 16)이고, 넘으면 503 `EDIT_VALIDATOR_BUSY`다. 응답 코드는 다음과 같다.

| 응답 | 뜻 |
| --- | --- |
| 200 | 검사했다(`valid`가 결과) |
| 422 `EDIT_VALIDATION_FAILED` | 요청·자산 검사 실패(해시 불일치, 받지 못한 자산, 형식 오류 등) |
| 503 `EDIT_VALIDATOR_BUSY` | 기다릴 자리가 없거나 차례가 너무 늦었다 |
| 503 `EDIT_VALIDATOR_UNAVAILABLE` | 검사 스레드가 뜨지 못했거나(모듈 누락 등) 죽었거나 45초를 넘겼다 |

Spring은 승인된 모델의 코 편집마다 이 검사기를 호출한다. 처리 시간은 서버 로그의 `edit_validator durationMs=<정수> waitMs=<정수>`로 확인한다. `durationMs`는 요청 본문 수신부터 검사 응답까지, `waitMs`는 그중 차례를 기다린 시간이며 브라우저 렌더·Spring 저장은 포함하지 않는다. 차례를 못 받으면 `edit_validator busy waitMs=<정수>`를 남긴다. 로그에 서명 URL·얼굴 자료·요청 본문은 남기지 않는다.

눈 편집은 같은 사설 검사기의 `POST /internal/ai/v1/eye`를 사용한다. Spring은 시안 행 잠금 전에 승인된 GLB·리그의 서명 URL, 각각의 SHA-256, 눈 부품 해시, 양쪽 눈 판정과 저장 후보 전체를 전송한다. 검사기는 자산의 해시·GLB의 눈 부품·판정을 대조하고 대표 피부의 두 눈 조합에 `isEyeStateSafe`를 적용한다. 이어 화면과 같은 방식으로 양쪽 눈을 합성하고 피부 메시마다 원본 대비 새 삼각형 교차를 검사한다. 이 검사 범위는 각 피부 메시 내부다. 눈·코를 합친 최종 메시와 서로 다른 피부 메시 사이의 교차는 별도 형상 검수가 필요하다. 응답은 `valid`와 결속 해시다. 오류·시간 초과·불안전 응답은 저장을 거절한다. 저장 거래는 모델과 시안을 다시 잠그고 상태 버전·자산 키·승인값·후보를 비교한다.

체중 변화와 윤곽 한 항목의 동시 편집은 `POST /internal/ai/v1/composite`와 `validatorVersion=1`을 사용한다(S15P31B204-621). 승인된 생성 GLB의 SHA-256·fit·양방향 타깃 쌍을 확인하고, 윤곽 단독과 요청한 정확한 두 가중치로 합친 최종 피부에서 보호 영역·접힘·새 자기교차를 검사한다. 응답은 `valid`와 모델 해시·fit·가중치를 되돌려 준다. Spring은 시안 행 잠금 밖에서 호출하고 저장 직전에 모델 승인·자산·시안 버전·가중치를 다시 비교한다. 실패·시간 초과·검사기 장애에는 저장하지 않는다. 눈·코·점 변경 또는 윤곽 복수 항목은 이 경로에서 지원하지 않는다.

작업 스레드는 `edit_validator stageMs mesh=<ms> rig=<ms> check=<ms> total=<ms>`를 기록한다. `mesh`·`rig`는 병렬 다운로드 각각의 시간이고 `check`는 모든 최종 메시 검사 호출의 합이다. 나머지는 해시·파싱·스레드 처리 시간이며, 이 숫자도 요청 내용 없이 기록한다.

## 변경 이력

- 2026-11-04: 눈 전체 상태 검사 경로와 저장 전 결속 재확인을 추가했다(S15P31B204-509).
- 2026-11-05: 바쁠 때 바로 거절하지 않고 차례를 기다리게 했고, 검사기 장애(503 `EDIT_VALIDATOR_UNAVAILABLE`)와 입력 검사 실패(422)를 나눴다(S15P31B204-592).
- 2026-11-06: 체중 변화·윤곽 한 항목의 정확한 최종 피부 검사 경로를 추가했다(S15P31B204-621).
- 2026-11-06: 눈 상태를 저장하기 전에 각 피부 메시의 새 자기교차를 검사한다(S15P31B204-647).
