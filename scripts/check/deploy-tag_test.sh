#!/bin/sh
# scripts/check/deploy-tag.sh 자체 테스트. sh scripts/check/deploy-tag_test.sh
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

mkdir -p "$TMP/.gitlab/ci"
printf 'stages: [verify]\n' > "$TMP/.gitlab-ci.yml"
printf 'deploy:dev:\n  tags: [preface-deploy]\n' > "$TMP/.gitlab/ci/deploy.yml"
printf 'web:lint:\n  image: node\n' > "$TMP/.gitlab/ci/web.yml"
sh "$HERE/deploy-tag.sh" "$TMP" >/dev/null || { echo "FAIL: deploy.yml만 쓰면 통과해야 한다"; fail=1; }

printf 'web:lint:\n  tags: [preface-deploy]\n' > "$TMP/.gitlab/ci/web.yml"
sh "$HERE/deploy-tag.sh" "$TMP" >/dev/null 2>&1 && { echo "FAIL: 다른 파일에서 쓰면 막아야 한다"; fail=1; }

printf 'x:\n  tags:\n    - preface-deploy\n' > "$TMP/.gitlab/ci/web.yml"
sh "$HERE/deploy-tag.sh" "$TMP" >/dev/null 2>&1 && { echo "FAIL: 목록 형식도 막아야 한다"; fail=1; }

[ "$fail" = 0 ] && echo "✓ deploy-tag 테스트 통과"
exit "$fail"
