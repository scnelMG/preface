# infra (인프라 코드)

서버·클라우드 구성과 배포 설정을 코드로 둔다. 배치 결정: [인프라 구성 방안](../docs/design/infra-options.md)

| 폴더 | 내용 |
| --- | --- |
| `aws/` | AWS(오민근 계정, 서울) S3 버킷·서버용 IAM 사용자 구성과 키 발급 (CloudShell에서 실행). 안내: [AWS 계정 안내](../docs/guides/aws-account.md) |
| `ec2/` | SSAFY EC2(운영 443·개발 8080) 기본 설정, 리버스 프록시(Caddy), 배포 전용 Runner, GPU 워커 SSH 터널 계정(`gpu-tunnel.sh`). 안내: [EC2 서버 안내](../docs/guides/ec2-server.md) |
| `ec2/app/` | 앱 묶음 compose(운영·개발 공용: MySQL·Redis·migrate·api·job-manager·web)와 환경 파일 틀 |
| `ec2/monitoring/` | 모니터링 묶음 compose(Prometheus·Grafana·node_exporter·cAdvisor), 수집 대상, Grafana 대시보드·알림. 안내: [EC2 서버 안내](../docs/guides/ec2-server.md) "모니터링" |
| `local/` | 로컬 개발용 MySQL·Redis·S3 호환 스토리지 compose |
| `ci-server/` | AWS CI 서버 기본 설정과 검사 Runner. 안내: [AWS CI 서버](../docs/guides/ci-server.md) |
| `runner/` | 임시 CI Runner(인프라 담당 PC) 시작 스크립트 |
| `merge-bot/` | 병합 봇 실행 스크립트 |

- 서버에서 손으로 바꾼 설정은 반드시 이 폴더에도 반영한다. SSAFY EC2는 복구가 초기화뿐이라, 여기 없는 설정은 사라진다.
- 담당: 인프라
