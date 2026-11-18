# web (프론트엔드)

브라우저 촬영, 업로드, 작업 상태 조회, GLB 편집·비교 화면을 담당한다.

- 기술: Next.js 16.4, React 19.3, TypeScript, Tailwind CSS 4, Zustand 5, three.js·React Three Fiber, MediaPipe
- 런타임·도구: Node.js 24 LTS, pnpm 11 ([툴체인](../../docs/specs/toolchain.md))
- 기능 범위: [서비스·인프라 구성 3절](../../docs/specs/service-infra.md)
- API 계약: [API 명세서 v2.7](../../docs/planning/03_API명세서_v2.7.md)

작업 규칙과 디자인 시스템(Figma `Foundations · v3` 토큰·컴포넌트) 사용법은 [AGENTS.md](AGENTS.md)에 있다.

## 실행

```sh
corepack enable pnpm       # 처음 한 번. pnpm 11을 쓴다 (package.json packageManager)
pnpm install
cp .env.example .env.local # API 주소를 맞춘다
pnpm dev                   # http://localhost:3000
```

Node는 24를 쓴다(`.nvmrc`). 다른 버전이 깔려 있으면 `nvm use`로 맞춘다.

| 명령              | 하는 일                                     |
| ----------------- | ------------------------------------------- |
| `pnpm dev`        | 개발 서버 (Turbopack)                       |
| `pnpm build`      | production 빌드                             |
| `pnpm start`      | 빌드 결과 실행                              |
| `pnpm verify`     | **커밋 전에 돌린다.** 포맷 검사·ESLint·타입 |
| `pnpm format`     | Prettier로 고친다                           |
| `pnpm lint`       | ESLint                                      |
| `pnpm typecheck`  | `tsc --noEmit`                              |
| `pnpm test`       | Vitest 1회 실행                             |
| `pnpm test:watch` | Vitest 감시 모드                            |
| `pnpm test:cov`   | 커버리지 포함 (Cobertura)                   |

CI(`.gitlab/ci/web.yml`)가 `verify` · `test` · `build`를 같은 명령으로 돌린다.

## 구조

```text
src/
  app/                   App Router. 라우트 그룹으로 layout을 나눈다
    (public)/            비로그인 — 랜딩, 체험 실험실
    (auth)/              가입 동의 (가입 토큰)
    (app)/               회원 — 작업실, 실험실, 알림, 내 정보
    (capture)/           휴대폰 업로드 전용 세션
  features/<도메인>/     도메인별 타입·API·스토어·훅
    auth/ edit/ reconstruction/
  shared/
    api/                 API 클라이언트, 공통 응답·에러 타입
    config/              환경 변수
    design/              디자인 토큰 (Figma Foundations · v3)
    ui/                  디자인 시스템 컴포넌트 (Button, Tab, SliderRow …)
public/                  정적 자산 (기본 모델 메시, 공개 샘플 머리 3종)
```

경로 별칭은 `@/*` → `src/*`다 (`tsconfig.json`, `vitest.config.mts`).

### 라우트

| 경로                          | 화면                            | 주요 API                      |
| ----------------------------- | ------------------------------- | ----------------------------- |
| `/`                           | 랜딩·메인                       | EDIT-01                       |
| `/services`                   | 서비스 (P3-17, 자리표시)        | —                             |
| `/lab`                        | 체험 실험실(비로그인)           | EDIT-01                       |
| `/signup`                     | 가입 동의 (SCR-02)              | AUTH-07, AUTH-08              |
| `/studio`                     | 내 작업실                       | HIS-01, HIS-06, REC-03        |
| `/studio/new`                 | 머리 추가·QR (SCR-16·17)        | CAP-02, QR-01·03·04           |
| `/reconstructions/[jobId]`    | 3D 생성 대기 (SCR-08·09)        | REC-02                        |
| `/simulations/[simulationId]` | 내 머리 수정                    | EDIT-03~08, CON-01·02, HIS-02 |
| `/notifications`              | 알림                            | NOTI-01, NOTI-02              |
| `/me`                         | 내 정보 (SCR-12~14)             | AUTH-05, AUTH-10·11, AUTH-04  |
| `/me/consents`                | 동의 기록 (SCR-03)              | AUTH-09, AUTH-07              |
| `/m/[linkToken]`              | 휴대폰 촬영·업로드              | QR-02, CAP-01·02, REC-01      |
| `/dev/design-system`          | 디자인 시스템 확인용 (운영 404) | —                             |

## 배포

standalone Docker·HTTPS 구성은 이 영역이 아니라 인프라가 맡는다([S15P31B204-260](https://ssafy.atlassian.net/browse/S15P31B204-260)).

- 이미지: [Dockerfile](Dockerfile). `next.config.ts`의 `output: 'standalone'`을 지우지 않는다.
- `NEXT_PUBLIC_API_BASE_URL`은 빌드 인자로 넣는다. 배포는 같은 출처 상대 경로 `/api/v1`을 넣어 이미지 하나를 개발·운영에 같이 쓴다(서버 프록시가 `/api/*`를 그 환경의 API로 보낸다). 그래서 API는 `shared/api`의 `api`로만 부르고, `API_BASE_URL`을 `new URL()`에 넣거나 절대 주소로 가정하지 않는다(S15P31B204-379).
