# contracts (서비스 간 계약)

영역 사이에서 주고받는 형식을 한곳에 둔다. 여기를 바꾸면 web·backend·gpu-worker 검사가 모두 실행된다.

- 브라우저 ↔ API: OpenAPI 명세
- 작업 관리자 ↔ GPU Pod: 작업 요청·상태·완료 manifest JSON Schema
- 각 형식의 합성 fixture (실제 얼굴 사진 금지)

CI의 `contract:check`가 lint, main 대비 하위 호환성, fixture 검증을 맡는다([CI/CD 명세](../docs/specs/cicd-pipeline.md)).
