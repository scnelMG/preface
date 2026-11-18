import type { NextConfig } from 'next'
import path from 'node:path'

const repositoryRoot = path.resolve(process.cwd(), '../..')

const nextConfig: NextConfig = {
  /* config options here */
  // 배포 이미지(apps/web/Dockerfile)는 실행에 필요한 파일만 담은 .next/standalone을 쓴다
  output: 'standalone',
  outputFileTracingRoot: repositoryRoot,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: repositoryRoot,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default nextConfig
