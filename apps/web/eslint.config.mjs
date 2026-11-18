import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // CI가 pnpm store를 여기에 둔다 (.gitlab/ci/common.yml의 .cache-web 경로와 맞춤).
    // 안에 패키지 원본이 들어 있어 검사 대상이 아니다.
    '.pnpm-store/**',
    'reports/**',
  ]),
])

export default eslintConfig
