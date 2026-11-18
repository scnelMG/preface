# 개발·검증 안내

공개용 사본의 실행 안내다. 운영 서버 접속과 비밀 값은 포함하지 않는다.

## 웹

Node.js 24와 pnpm 11을 준비한다. 저장소 루트에서 실행한다.

```sh
cd apps/web
corepack enable pnpm
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

`http://localhost:3000/lab`은 합성 기본 모델을 사용하는 화면이다. 로그인과 서버 기반 상담·저장 기능까지 사용하려면 API를 별도로 구성해야 한다. `.env.local`은 로컬에서만 관리한다.

```sh
pnpm verify
pnpm test
pnpm build
```

## 백엔드·로컬 의존 서비스

JDK 25와 Docker를 준비한다. 저장소 루트에서 로컬 MySQL·Redis·S3 호환 스토리지를 시작한다.

```sh
docker compose -f infra/local/compose.yaml up -d
cd services/backend
./gradlew test
./gradlew integrationTest
```

Windows에서는 `gradlew.bat`을 사용할 수 있다. API 실행은 로컬 프로필을 사용하며 DB·S3·JWT 환경 변수의 실제 값을 개인 환경에서 설정한다. OAuth와 GMS 자격 증명은 별도 발급·설정이 필요하다.

## Python 서비스·3D 생성

Python 3.12와 uv를 사용한다.

```sh
cd services/gpu-worker
uv sync --frozen
uv run pytest
```

위 의존성과 명령은 FastAPI 서비스·단위 테스트용이다. 전체 얼굴 복원에는 추가 파이프라인 의존성, COLMAP·모델 자료·GPU 환경이 필요하다. [복원 파이프라인 README](../services/gpu-worker/reconstruction/README.md)와 requirements 파일을 확인한다. GPU 워커의 운영 터널·접속 스크립트는 공개본에 포함하지 않는다.

## 공개본의 차이

- 분석 도구의 프로젝트 ID는 비어 있다.
- 홍보용 MetaHuman·랜딩 자산은 제외했다. 일부 랜딩 연출의 원본 화면을 재현하지 못할 수 있다.
- GNM 기반 합성 샘플과 원본 라이선스는 남겨 두었다.
- 위 명령은 저장소에서 사용하는 개발·검증 방법이다. 이번 공개본 준비에서 모두 실행했다는 뜻은 아니다.

전체 공개 범위는 [공개용 사본의 범위](public-scope.md)에 있다.
