# syntax=docker/dockerfile:1
# Multi-stage build (PLAN.md 7.3). Build context: repository root.
#   docker build -f infra/docker/Dockerfile -t whiteboard .

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-trixie AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY patches patches/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# Production dependencies of the server (the bundle keeps the native modules better-sqlite3 and
# @node-rs/argon2 external). Prebuilt binaries for other platforms and the SQLite sources are
# not needed at runtime.
RUN pnpm --filter @wb/server deploy --prod /out \
  && cd /out/node_modules/.pnpm \
  && find . -path '*/better-sqlite3/prebuilds/*' ! -name 'linux-x64.node' -delete \
  && rm -rf ./better-sqlite3@*/node_modules/better-sqlite3/deps ./better-sqlite3@*/node_modules/better-sqlite3/src

FROM node:${NODE_VERSION}-trixie-slim AS runtime
# ffmpeg/ffprobe (audio, video) and poppler (PDF) since Phase 2; tesseract follows with Phase 8.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates ffmpeg poppler-utils \
  && rm -rf /var/lib/apt/lists/*

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    UV_THREADPOOL_SIZE=2 \
    APP_VERSION=${APP_VERSION}

WORKDIR /app
COPY --from=build /out/node_modules apps/server/node_modules
COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/server/drizzle apps/server/drizzle
COPY --from=build /src/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "/app/apps/server/dist/healthcheck.js"]
ENTRYPOINT ["tini", "--"]
CMD ["node", "--enable-source-maps", "apps/server/dist/index.js"]
