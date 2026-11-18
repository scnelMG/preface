# scripts

사람·AI 도구·CI가 함께 쓰는 스크립트를 둔다. 같은 규칙은 같은 스크립트로 검사한다([하네스 구조](../docs/design/harness.md)).

| 폴더 | 내용 | 추가 시점 |
| --- | --- | --- |
| `check/` | 브랜치·커밋·MR 제목·MR 본문 검사 (git hook·CI 공용), `*_test.sh` 자체 테스트 | S4·S5 |
| `dev/` | `setup.sh`(1회), `new-branch.sh`, `mr-context.sh`, `mr-create.sh` | S5 |
| `gitlab/` | GitLab 프로젝트 설정·라벨 적용 (`apply-settings.sh`) | S3a |
| `release/` | 릴리스 태그 생성 | 운영 배포 단계 |

- 셸 스크립트는 LF 줄바꿈이어야 한다(`.gitattributes`로 고정).
- 토큰·비밀번호를 스크립트에 넣지 않는다.
