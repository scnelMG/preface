# gpu-worker (얼굴 생성)

Runpod GPU Pod에서 실행되는 FastAPI 서비스다. S3에서 입력을 받아 얼굴 피팅·텍스처 생성·GLB 패키징을 하고 결과와 완료 manifest를 올린다.

- 기술: FastAPI, PyTorch 2.14 (GPU `cu126`, CI는 CPU 빌드), FLAME 2023 Open, nvdiffrast(후보)
- 런타임·도구: Python 3.12, uv, ruff, CUDA 12.6 ([툴체인](../../docs/specs/toolchain.md))
- 담당: AI (미정)
- 기능 범위: [서비스·인프라 구성 5절](../../docs/specs/service-infra.md)

## 상담 API (S15P31B204-73)

`POST /internal/ai/v1/consult`는 Spring에서만 호출하는 무상태 **편집 후보 해석** API다. `contracts/edit/consult-apply-v1.md`의 v2 효과를 반환하고, 정점 계산·DB 저장·적용 성공 답변은 하지 않는다. 명확한 흔한 문장은 로컬에서 해석하고 나머지는 GMS `gpt-6-luna`로 보낸다. GMS에는 마스킹한 문장·최근 대화 최대 4개(각 200자)·현재 상대 조절값만 전송한다. 얼굴 이미지·영상·GLB는 보내지 않는다. 요청의 `measurements`는 S15P31B204-122에서 검증된 필드와 GMS 처리 조건이 정해지기 전까지 전달하지 않는다.

```bash
uv sync --frozen
uv run ruff check app tests
uv run python -m pytest -q
INTERNAL_API_SECRET=<32바이트 이상> GMS_KEY=<서버 키> uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
docker build -f Dockerfile.consult -t preface-consult .
```

요청에는 `X-Internal-Secret`이 필요하다. 키가 없거나 GMS가 실패하면 자동 편집 후보를 내지 않는다. GMS 잔액이 1,782,000크레딧 아래로 내려갈 우려가 있으면 호출을 막는다. `allowedCodes`는 v2 저장 코드(예: `eye.tail_angle.right`)를 받으며, 상담 후보의 눈 `code`+`side`가 그 코드에 맞는지 확인한다. `both` 요청은 양쪽 코드가 모두 지원될 때만 후보를 낸다. 응답의 `changeRequest`는 후보이며, Spring이 시안·모델 지원 범위와 `stateVersion`을 확인해 적용·저장한 뒤에만 FE가 After와 성공 문구를 표시한다. 조절 범위 질문에는 `recommendedSliderCode`를 반환해 FE가 해당 슬라이더를 열 수 있다. 예시 칩 선택·더/덜·undo/redo/reset·오래된 선택지 검사는 Spring/FE에서 현재 시안 상태를 읽어 처리한다.

## 프레임 추출 워커 (S15P31B204-353)

EC2에서 도는 CPU 워커다(GPU 아님). Spring 내부 API(INT-EXT-01~03)로 작업을 가져가, 원본 영상에서 AI 파트 추출 명령
(`reconstruction/tools/frames_bundle.py extract`, S15P31B204-355)으로 프레임 묶음(tar)을 만들어 올린다.
계약·묶음 형식: [`contracts/frame-extraction`](../../contracts/frame-extraction/README.md).

```bash
docker build -f Dockerfile.extract -t preface-extractor .   # 추출 패키지·얼굴 인식 모델 포함
INTERNAL_API_SECRET=<시크릿> EXTRACTOR_API_BASE=http://127.0.0.1:8080 uv run python -m app.extractor.worker
```

- 추출 명령 기본값은 워커와 같은 Python으로 `reconstruction/tools/frames_bundle.py`. 다른 명령은 `EXTRACT_CMD`로 바꾼다.
- 로컬에서 워커를 직접 돌리려면 `uv pip install -r reconstruction/requirements-extract.txt`와 `cd reconstruction && python tools/fetch_models.py`가 먼저 필요하다. 버전은 바꾸지 않는다(영상 디코더 버전에 따라 뽑히는 프레임이 달라진다).

현재 Python 프로젝트에는 상담 경로만 있다. GPU 복원 작업·최종 메시 변형(INT-AI-02)·Spring CON-01/EDIT-05 연결·FE 뷰어는 후속 이슈다. 모델 가중치는 Git에 넣지 않는다.
