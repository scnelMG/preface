#!/bin/sh
# naming.sh 자체 테스트. 규칙을 바꾸면 여기에 예시를 함께 추가한다.
# 실행: sh scripts/check/naming_test.sh

set -u
DIR="$(dirname "$0")"
PASS=0
FAIL=0

expect() { # 기대(ok|ng) 설명 인자...
  want="$1"; shift
  if sh "$DIR/naming.sh" "$@" >/dev/null 2>&1; then got=ok; else got=ng; fi
  if [ "$got" = "$want" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1)); echo "FAIL: 기대 $want, 결과 $got: $*"
  fi
}

# 브랜치
expect ok branch "feat/12-camera-guide"
expect ok branch "fix/3-s3-upload-url"
expect ok branch "perf/40-glb-load"
expect ok branch "hotfix/7-login"
expect ng branch "feature/12-camera-guide"      # 유형 오타
expect ng branch "feat/S15P31B204-12-camera"     # 키 전체
expect ng branch "feat/camera-guide"             # 번호 없음
expect ng branch "feat/12-Camera-Guide"          # 대문자
expect ng branch "feat/12-camera_guide"          # 밑줄
expect ng branch "feat/12-"                      # 설명 없음
expect ng branch "feat/12-camera-"               # 하이픈으로 끝남
expect ng branch "revert-a1b2c3d4"               # GitLab Revert 버튼 브랜치
expect ng branch "main"

# 커밋 첫 줄
expect ok commit-subject "feat: 얼굴 촬영 가이드 추가"
expect ok commit-subject "docs: README 수정"
expect ok commit-subject "Merge branch 'main' into feat/12-camera-guide"
expect ok commit-subject 'Revert "feat: 얼굴 촬영 가이드 추가"'
expect ok commit-subject "fixup! feat: 얼굴 촬영 가이드 추가"
expect ng commit-subject "얼굴 촬영 가이드 추가"
expect ng commit-subject "feat:얼굴 촬영 가이드 추가"   # 콜론 뒤 공백 없음
expect ng commit-subject "Feat: 얼굴 촬영 가이드 추가"  # 대문자 유형
expect ng commit-subject "feature: 얼굴 촬영 가이드 추가"
expect ng commit-subject "feat: "

# 커밋 메시지 파일 (주석·빈 줄 건너뜀)
TMP="$(mktemp)"
printf '\n# 주석\nfeat: 얼굴 촬영 가이드 추가\n\n본문\n' > "$TMP"
expect ok commit "$TMP"
printf '# 주석만\n\n' > "$TMP"
expect ng commit "$TMP"
rm -f "$TMP"

# MR 제목
expect ok mr "[S15P31B204-12] 얼굴 촬영 가이드 구현" "feat/12-camera-guide"
expect ok mr "Draft: [S15P31B204-12] 얼굴 촬영 가이드 구현" "feat/12-camera-guide"
expect ng mr "[S15P31B204-13] 얼굴 촬영 가이드 구현" "feat/12-camera-guide"   # 번호 불일치
expect ng mr "얼굴 촬영 가이드 구현" "feat/12-camera-guide"                   # 키 없음
expect ng mr "[S15P31B204-12]얼굴 촬영 가이드 구현" "feat/12-camera-guide"     # 공백 없음
expect ng mr "#12 얼굴 촬영 가이드 구현" "feat/12-camera-guide"
expect ng mr "[S15P31B204-12] 얼굴 촬영 가이드 구현" "camera-guide"           # 브랜치 형식

# 태그
expect ok tag "v0.1.0"
expect ok tag "v10.20.30"
expect ng tag "0.1.0"
expect ng tag "v0.1"
expect ng tag "v0.1.0-rc1"

echo "naming.sh 테스트: 통과 $PASS, 실패 $FAIL"
[ "$FAIL" -eq 0 ]
