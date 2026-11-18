# backend (API·작업 관리자)

로그인, 파일·작업 권한, 서명 URL 발급, 작업 접수·조회를 맡는 Spring Boot API와, 3D 복원 작업을 관리하는 작업 관리자를 담당한다. 둘은 같은 이미지를 역할에 따라 별도 프로세스로 실행한다.

- 기술: Spring Boot 4.1, Spring Security, Spring Data JPA, **MySQL 8**, **Redis 7**, Flyway
- 런타임·도구: Temurin 25 LTS, Gradle 9.8 Wrapper ([툴체인](../../docs/specs/toolchain.md))
- 담당: BE (mingeunoh5312)
- 기능 범위: [서비스·인프라 구성 4절](../../docs/specs/service-infra.md)
- 작업 규칙·명령: [AGENTS.md](AGENTS.md)

## 빠른 시작

```bash
cd services/backend
./gradlew test                 # 단위 테스트
./gradlew integrationTest      # Docker 필요 (MySQL·Redis 컨테이너를 자동으로 띄운다)
```

로컬에서 서버를 띄우려면 MySQL 8·Redis 7·S3 호환 스토리지가 필요하다. 저장소 루트에서 [로컬 compose](../../infra/local/compose.yaml)로 띄운다(DB 비밀번호 기본값 `preface`, S3는 `http://localhost:9000`·버킷 `preface-local`, 키는 아무 값).

```bash
docker compose -f infra/local/compose.yaml up -d   # 저장소 루트에서
DB_PASSWORD=preface JWT_SECRET=<32바이트 이상 아무 문자열> S3_ACCESS_KEY=local S3_SECRET_KEY=local ./gradlew :api:bootRun --args='--spring.profiles.active=local'
curl localhost:8080/actuator/health   # {"status":"UP"}
```

## 프로필

| 프로필 | 용도 | Flyway |
| --- | --- | --- |
| (기본) | 운영·개발 서버. 접속 정보는 환경 변수 `DB_URL`·`DB_USERNAME`·`DB_PASSWORD`·`REDIS_HOST`·`REDIS_PORT`·`REDIS_PASSWORD`(비어 있으면 인증 없음) | 끔 |
| `local` | 개인 PC | 시작 때 실행 |
| `migrate` | 배포 시 migration만 실행하고 종료 | 실행 후 종료 |
| `it` | 통합 테스트 | 시작 때 실행 |

## 환경 변수 (인증)

값은 저장소에 쓰지 않는다. 로컬은 사용자 환경 변수, 배포는 서버·CI 변수(Masked)로 넣는다.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `JWT_SECRET` | O | access·가입 토큰 서명 키(HS256, 32바이트 이상). 없거나 짧으면 앱이 시작하지 않는다 |
| `OAUTH_KAKAO_CLIENT_ID` / `OAUTH_KAKAO_CLIENT_SECRET` | 로그인 시 | 카카오 REST API 키 / Client Secret |
| `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET` | 로그인 시 | 구글 OAuth 웹 클라이언트 |
| `OAUTH_ALLOWED_REDIRECT_URIS` | 운영 | 쉼표로 구분한 FE 콜백 주소. `local` 프로필 기본값은 `http://localhost:3000/oauth/kakao`, `.../google` |
