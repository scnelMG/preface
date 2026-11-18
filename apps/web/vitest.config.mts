import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// CI(web:test)는 JUnit XML과 Cobertura를 요구한다 (docs/specs/cicd-pipeline.md "검사 job 명세").
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // 테스트 하나가 findBy*·waitFor(vitest.setup.ts, 5초)를 여러 번 기다려도 넘치지 않게 둔다
    testTimeout: 20_000,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: './reports/junit.xml' },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'cobertura'],
      reportsDirectory: './reports/coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/app/**/layout.tsx'],
    },
  },
})
