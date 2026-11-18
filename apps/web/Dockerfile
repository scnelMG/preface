# 웹(Next.js) 배포 이미지. next build의 standalone 출력만 담아 node server.js로 띄운다.
# 빌드: docker build --build-context engine=services/gpu-worker/reconstruction/engine --build-arg NEXT_PUBLIC_API_BASE_URL=/api/v1 -t preface-web apps/web
# NEXT_PUBLIC_ 값은 빌드할 때 브라우저 번들에 박힌다. 배포는 같은 출처 상대 경로 /api/v1을 넣어 이미지 하나를 개발·운영에 같이 쓴다(S15P31B204-379).
# node 태그는 .nvmrc(24)와 같은 메이저를 쓴다.

FROM node:24.21.0-alpine3.24 AS base
ENV PNPM_HOME=/pnpm \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm
WORKDIR /repo/apps/web

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store --location project \
 && pnpm install --frozen-lockfile
COPY . .
COPY --from=engine nose-engine.mjs /repo/services/gpu-worker/reconstruction/engine/
COPY --from=engine effect-codes.mjs /repo/services/gpu-worker/reconstruction/engine/
COPY --from=engine contour-codes.mjs /repo/services/gpu-worker/reconstruction/engine/
COPY --from=engine point-strokes.mjs /repo/services/gpu-worker/reconstruction/engine/
COPY --from=engine eye-edit.mjs eye-edit.d.mts edit-limit.mjs mesh-audit.mjs lid-step.json lid-rows.json /repo/services/gpu-worker/reconstruction/engine/
COPY --from=engine nose-skin-audit.mjs nose-skin-audit.d.mts /repo/services/gpu-worker/reconstruction/engine/
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_ASSET_BASE_URL=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_ASSET_BASE_URL=$NEXT_PUBLIC_ASSET_BASE_URL
RUN test -n "$NEXT_PUBLIC_API_BASE_URL" || { echo "NEXT_PUBLIC_API_BASE_URL 빌드 인자가 필요하다"; exit 1; } \
 && pnpm build

FROM node:24.21.0-alpine3.24
WORKDIR /repo
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    TZ=Asia/Seoul
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
