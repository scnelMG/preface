#!/bin/sh
# 배포 Runner 태그(preface-deploy)를 .gitlab/ci/deploy.yml 밖에서 쓰지 못하게 한다.
# 배포 Runner는 운영 서버에서 돈다. 다른 CI 파일에서 이 태그를 쓰면 "배포 관련 파일은 다른 팀원 Approve" 규칙을 피해 간다.
#   sh scripts/check/deploy-tag.sh [저장소 루트]
set -eu

ROOT="${1:-.}"
found=$(cd "$ROOT" && grep -rln 'preface-deploy' .gitlab-ci.yml .gitlab/ci 2>/dev/null | grep -vx '.gitlab/ci/deploy.yml' || true)
if [ -n "$found" ]; then
  echo "배포 Runner 태그 preface-deploy는 .gitlab/ci/deploy.yml에서만 쓴다. 다음 파일에서 지운다:" >&2
  printf '  %s\n' $found >&2
  exit 1
fi
echo "✓ 배포 Runner 태그 검사 통과"
