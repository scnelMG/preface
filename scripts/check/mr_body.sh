#!/bin/sh
# MR 본문이 템플릿 규칙을 지켰는지 검사한다. 작성법: docs/conventions/mr.md
#   sh scripts/check/mr_body.sh <본문 파일>
# mr-create.sh가 MR을 만들기 전에 부른다. AI가 대충 채운 본문을 여기서 잡는다.
#
# 검사
#   - 맨 위 표: S15P31B204-<번호> | 유형 | 영역(FE·BE·AI·INF)
#   - "## 무엇을, 왜", "## 검증" 내용이 비어 있지 않다 (HTML 주석 제외)
#   - "## 영향"의 다섯 항목(API·계약, DB, 모델·GPU, 설정·환경 변수, 배포·복구)에 값이 있다 (해당 없으면 "없음")
#   - <번호> <유형> <영역> <요약> 같은 자리표시자가 남아 있지 않다

set -u
[ -f "${1:-}" ] || { echo "사용법: mr_body.sh <본문 파일>" >&2; exit 2; }

awk '
  BEGIN { incomment=0; section="" }
  {
    line=$0
    sub(/\r$/, "", line)
    # HTML 주석 제거 (여러 줄 포함)
    out=""
    while (length(line) > 0) {
      if (incomment) {
        e=index(line, "-->"); if (e == 0) { line=""; break }
        line=substr(line, e+3); incomment=0
      } else {
        s=index(line, "<!--"); if (s == 0) { out=out line; line=""; break }
        out=out substr(line, 1, s-1); line=substr(line, s+4); incomment=1
      }
    }
    line=out

    if (line ~ /<(번호|유형|영역|요약)>/) placeholder=1
    if (line ~ /^\| *S15P31B204-[0-9]+ *\| *(feat|fix|refactor|perf|test|chore|docs|hotfix) *\| *(FE|BE|AI|INF)( *, *(FE|BE|AI|INF))* *\| *$/) table=1

    if (line ~ /^## /) { section=line; seen[section]=1; next }
    if (section == "## 무엇을, 왜" && line ~ /[^[:space:]]/) what=1
    if (section == "## 검증" && line ~ /^- *[^[:space:]]/) verify=1
    if (section == "## 영향") {
      n=split("API·계약|DB|모델·GPU|설정·환경 변수|배포·복구", items, "|")
      for (i=1; i<=n; i++) {
        prefix="- " items[i] ":"
        if (index(line, prefix) == 1) {
          rest=substr(line, length(prefix)+1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", rest)
          if (rest != "") filled[items[i]]=1
        }
      }
    }
  }
  END {
    bad=0
    if (!table) { print "✗ 맨 위 표의 이슈·유형·영역 줄이 없거나 형식이 다르다 (mr-create.sh가 채운다)"; bad=1 }
    if (!seen["## 무엇을, 왜"] || !what) { print "✗ \"## 무엇을, 왜\" 내용이 비어 있다"; bad=1 }
    if (!seen["## 검증"] || !verify) { print "✗ \"## 검증\"에 실행한 명령과 결과를 \"- \"로 적는다 (안 했으면 \"- 미실행: 이유\")"; bad=1 }
    if (!seen["## 영향"]) { print "✗ \"## 영향\" 섹션이 없다"; bad=1 }
    else {
      n=split("API·계약|DB|모델·GPU|설정·환경 변수|배포·복구", items, "|")
      for (i=1; i<=n; i++) if (!filled[items[i]]) { print "✗ 영향의 \"" items[i] "\" 값이 비어 있다 (해당 없으면 \"없음\")"; bad=1 }
    }
    if (placeholder) { print "✗ <번호>·<유형>·<영역>·<요약> 같은 자리표시자가 남아 있다"; bad=1 }
    if (bad) { print "  작성법: docs/conventions/mr.md"; exit 1 }
    print "✓ MR 본문 규칙 통과"
  }
' "$1"
