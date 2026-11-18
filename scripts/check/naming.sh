#!/bin/sh
# 브랜치·커밋·MR 제목·태그 이름 규칙 검사. 규칙 원본: docs/conventions/git.md
# CI(check:naming)와 git hook이 같이 쓴다. alpine에서도 돌도록 POSIX sh로 쓴다.
#
# 사용법
#   naming.sh branch <브랜치>
#   naming.sh commit <커밋 메시지 파일>     (commit-msg hook)
#   naming.sh commit-subject <첫 줄>
#   naming.sh mr <MR 제목> <브랜치>
#   naming.sh tag <태그>
# 통과하면 0, 어기면 1을 반환하고 이유와 예시를 출력한다.

set -u

KEY="S15P31B204"
TYPES="feat|fix|refactor|perf|test|chore|docs|hotfix"
RULES="docs/conventions/git.md"

fail() {
  echo "✗ $1" >&2
  [ -n "${2:-}" ] && echo "  예: $2" >&2
  echo "  규칙: $RULES" >&2
  exit 1
}

matches() { printf '%s\n' "$1" | grep -Eq "$2"; }

check_branch() {
  b="$1"
  matches "$b" "^($TYPES)/[0-9]+-[a-z0-9]+(-[a-z0-9]+)*\$" ||
    fail "브랜치 이름이 '<유형>/<번호>-<설명>' 형식이 아니다: $b" "feat/12-camera-guide (설명은 영어 소문자·숫자·하이픈)"
}

check_subject() {
  s="$1"
  # 검사하지 않는 커밋: 병합, git revert, autosquash
  case "$s" in
    "Merge "* | "Revert \""* | "fixup! "* | "squash! "*) return 0 ;;
  esac
  matches "$s" "^($TYPES): [^ ].*" ||
    fail "커밋 메시지 첫 줄이 '<유형>: <요약>' 형식이 아니다: $s" "feat: 얼굴 촬영 가이드 추가 (유형: ${TYPES})"
}

check_commit_file() {
  # 주석(#)과 빈 줄을 건너뛴 첫 줄을 검사한다.
  subject="$(grep -v '^#' "$1" | grep -v '^[[:space:]]*$' | head -n 1)"
  [ -n "$subject" ] || fail "커밋 메시지가 비어 있다" "feat: 얼굴 촬영 가이드 추가"
  check_subject "$subject"
}

check_mr() {
  title="${1#Draft: }"
  branch="$2"
  matches "$title" "^\[$KEY-[0-9]+\] [^ ].*" ||
    fail "MR 제목이 '[$KEY-<번호>] <요약>' 형식이 아니다: $1" "[$KEY-12] 얼굴 촬영 가이드 구현"
  check_branch "$branch"
  title_no="$(printf '%s' "$title" | sed -E "s/^\[$KEY-([0-9]+)\].*/\1/")"
  branch_no="$(printf '%s' "$branch" | sed -E 's#^[a-z]+/([0-9]+)-.*#\1#')"
  [ "$title_no" = "$branch_no" ] ||
    fail "MR 제목 번호($title_no)와 브랜치 번호($branch_no)가 다르다" "브랜치 feat/12-… → 제목 [$KEY-12] …"
}

check_tag() {
  matches "$1" '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail "릴리스 태그가 'vMAJOR.MINOR.PATCH' 형식이 아니다: $1" "v0.1.0"
}

case "${1:-}" in
  branch) check_branch "${2:-}" ;;
  commit) check_commit_file "${2:?커밋 메시지 파일이 필요하다}" ;;
  commit-subject) check_subject "${2:-}" ;;
  mr) check_mr "${2:-}" "${3:-}" ;;
  tag) check_tag "${2:-}" ;;
  *) sed -n '2,11p' "$0"; exit 2 ;;
esac

echo "✓ ${1} 규칙 통과"
